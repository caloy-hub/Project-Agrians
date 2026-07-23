// supabase/functions/generate-sf4/index.ts
//
// Generates School Form 4 (Monthly Learner's Movement and Attendance /
// Absenteeism Report) for either Junior High School (Grades 7–10) or Senior
// High School (Grades 11–12, broken down by track), for one month.
//
// Movement figures (transferred in/out, dropped out) come from
// profiles.enrollment_status + status_date. Attendance figures come from the
// daily_attendance grid the same way School Form 2 does.
//
// Invoke: POST { level: "JHS" | "SHS", month, year, term }
// Returns: application/pdf binary

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MM = 2.83465;
const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 12 * MM;

const SCHOOL_INFO = {
  region: "Region XI",
  division: "SCHOOLS DIVISION OF DAVAO CITY",
  school: "Maria Cristina P. Belcar Agricultural High School",
  schoolId: "304342",
};

const TERM_MONTHS: { month:number; year:number; term:number; startDay?:number; endDay?:number }[] = [
  { month:6,  year:2026, term:1, startDay:8 },
  { month:7,  year:2026, term:1 },
  { month:8,  year:2026, term:1 },
  { month:9,  year:2026, term:1, endDay:15 },
  { month:9,  year:2026, term:2, startDay:16 },
  { month:10, year:2026, term:2 },
  { month:11, year:2026, term:2 },
  { month:12, year:2026, term:2, endDay:18 },
  { month:1,  year:2027, term:3, startDay:4 },
  { month:2,  year:2027, term:3 },
  { month:3,  year:2027, term:3 },
  { month:4,  year:2027, term:3, endDay:8 },
];
const MONTH_NAMES = ["","January","February","March","April","May","June","July","August","September","October","November","December"];

function schoolDaysInMonth(month:number, year:number, term:number, holidays:{date:string}[]) {
  const tm = TERM_MONTHS.find(t=>t.month===month&&t.year===year&&t.term===term);
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = tm?.startDay || 1, end = tm?.endDay || daysInMonth;
  const out: string[] = [];
  for (let d=start; d<=end; d++) {
    const dow = new Date(year, month-1, d).getDay();
    if (dow===0||dow===6) continue;
    const iso = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (holidays.some(h=>h.date===iso)) continue;
    out.push(iso);
  }
  return out;
}

class Drawer {
  page: PDFPage; fReg: PDFFont; fBold: PDFFont;
  constructor(page: PDFPage, fReg: PDFFont, fBold: PDFFont) { this.page=page; this.fReg=fReg; this.fBold=fBold; }
  text(x:number,y:number,str:string,font:PDFFont,size:number) { this.page.drawText(str,{x,y,size,font,color:rgb(0,0,0)}); }
  centered(cx:number,y:number,str:string,font:PDFFont,size:number) {
    const w=font.widthOfTextAtSize(str,size); this.text(cx-w/2,y,str,font,size);
  }
  line(x1:number,y1:number,x2:number,y2:number,width=0.7) {
    this.page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:width,color:rgb(0,0,0)});
  }
  rect(x:number,y:number,w:number,h:number,width=0.8) {
    this.page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(0,0,0),borderWidth:width,opacity:0});
  }
}

type Row = {
  label: string; m0:number; f0:number;
  transferredIn:number; transferredOut:number; droppedOut:number;
  m1:number; f1:number; ada:number; pct:number;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: callerProfile } = await callerClient.from("profiles").select("role").eq("id",caller.id).single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { level, month, year, term } = await req.json();
    if (!level || !month || !year || !term || !["JHS","SHS"].includes(level)) {
      return new Response(JSON.stringify({ error: "level (JHS|SHS), month, year, term are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const grades: number[] = level==="JHS" ? [7,8,9,10] : [11,12];

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: allStudents }, { data: holidays }] = await Promise.all([
      adminClient.from("profiles").select("*").eq("role","student").in("grade_level",grades),
      adminClient.from("school_holidays").select("date"),
    ]);
    const days = schoolDaysInMonth(month, year, term, holidays||[]);
    const monthStart = days.length ? days[0] : `${year}-${String(month).padStart(2,"0")}-01`;
    const monthEnd = days.length ? days[days.length-1] : `${year}-${String(month).padStart(2,"0")}-28`;

    const allIds = (allStudents||[]).map(s=>s.id);
    let dailyRows: {student_id:string; status:string}[] = [];
    if (allIds.length && days.length) {
      const { data } = await adminClient.from("daily_attendance").select("student_id,status,date")
        .in("student_id", allIds).gte("date", days[0]).lte("date", days[days.length-1]);
      dailyRows = data || [];
    }

    const movedInRange = (s:any) => s.status_date && s.status_date >= monthStart && s.status_date <= monthEnd;

    const computeRow = (label:string, group:any[]): Row => {
      const currentlyEnrolled = group.filter(s=>s.enrollment_status==="Active"||s.enrollment_status==="Transferred In");
      const transferredInThisMonth = group.filter(s=>s.enrollment_status==="Transferred In" && movedInRange(s));
      const transferredOutThisMonth = group.filter(s=>s.enrollment_status==="Transferred Out" && movedInRange(s));
      const droppedOutThisMonth = group.filter(s=>s.enrollment_status==="Dropped Out" && movedInRange(s));

      const beginning = currentlyEnrolled.length + transferredOutThisMonth.length + droppedOutThisMonth.length - transferredInThisMonth.length;
      const beginningM = currentlyEnrolled.filter(s=>s.gender==="Male").length
        + transferredOutThisMonth.filter(s=>s.gender==="Male").length + droppedOutThisMonth.filter(s=>s.gender==="Male").length
        - transferredInThisMonth.filter(s=>s.gender==="Male").length;
      const beginningF = beginning - beginningM;

      const endingM = currentlyEnrolled.filter(s=>s.gender==="Male").length;
      const endingF = currentlyEnrolled.filter(s=>s.gender==="Female").length;

      const enrolledIds = new Set(currentlyEnrolled.map(s=>s.id));
      const present = dailyRows.filter(r=>enrolledIds.has(r.student_id) && r.status==="present").length;
      const ada = days.length>0 ? Math.round((present/days.length)*10)/10 : 0;
      const slots = currentlyEnrolled.length*days.length;
      const pct = slots>0 ? Math.round((present/slots)*1000)/10 : 0;

      return {
        label, m0:Math.max(beginningM,0), f0:Math.max(beginningF,0),
        transferredIn: transferredInThisMonth.length, transferredOut: transferredOutThisMonth.length,
        droppedOut: droppedOutThisMonth.length, m1: endingM, f1: endingF, ada, pct,
      };
    };

    const rows: Row[] = [];
    if (level==="JHS") {
      grades.forEach(g=>rows.push(computeRow(`Grade ${g}`, (allStudents||[]).filter(s=>s.grade_level===g))));
    } else {
      grades.forEach(g=>{
        const gradeGroup = (allStudents||[]).filter(s=>s.grade_level===g);
        const tracks = Array.from(new Set(gradeGroup.map(s=>s.shs_track||"(No track set)"))).sort();
        rows.push(computeRow(`Grade ${g} — TOTAL`, gradeGroup));
        tracks.forEach(t=>rows.push(computeRow(`   ${t}`, gradeGroup.filter(s=>(s.shs_track||"(No track set)")===t))));
      });
    }
    const grand = computeRow("SCHOOL TOTAL", allStudents||[]);

    const pdfDoc = await PDFDocument.create();
    const fReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const d = new Drawer(page, fReg, fBold);

    let y = PAGE_H - MARGIN;
    d.centered(PAGE_W/2, y, "Department of Education", fBold, 11); y -= 4.6*MM;
    d.centered(PAGE_W/2, y, `${SCHOOL_INFO.region}  ·  ${SCHOOL_INFO.division}`, fReg, 9); y -= 4.4*MM;
    d.centered(PAGE_W/2, y, SCHOOL_INFO.school, fBold, 11); y -= 4.6*MM;
    d.centered(PAGE_W/2, y, `School ID: ${SCHOOL_INFO.schoolId}`, fReg, 8.5); y -= 6*MM;
    d.centered(PAGE_W/2, y,
      `SCHOOL FORM 4 (SF4) — MONTHLY LEARNER'S MOVEMENT AND ATTENDANCE/ABSENTEEISM REPORT (${level})`,
      fBold, 12); y -= 6*MM;
    d.centered(PAGE_W/2, y, `For the Month of ${MONTH_NAMES[month]} ${year} — Term ${term}`, fReg, 10);
    y -= 8*MM;

    // ---- table ----
    const contentW = PAGE_W - 2*MARGIN;
    const cols = [
      { key:"label", label:"Grade / Track", w:60*MM, align:"left" },
      { key:"m0", label:"Beg. M", w:16*MM },
      { key:"f0", label:"Beg. F", w:16*MM },
      { key:"bt", label:"Beg. Total", w:18*MM },
      { key:"transferredIn", label:"Transferred\nIn", w:20*MM },
      { key:"transferredOut", label:"Transferred\nOut", w:20*MM },
      { key:"droppedOut", label:"Dropped\nOut", w:18*MM },
      { key:"m1", label:"End M", w:16*MM },
      { key:"f1", label:"End F", w:16*MM },
      { key:"et", label:"End Total", w:18*MM },
      { key:"ada", label:"ADA", w:16*MM },
      { key:"pct", label:"% Attend.", w:18*MM },
    ];
    const usedW = cols.reduce((s,c)=>s+c.w,0);
    cols[0].w += Math.max(contentW - usedW, 0); // give any leftover width to the label column

    const headerH = 10*MM, rowH = 6.2*MM;
    const tableTop = y;
    d.rect(MARGIN, tableTop-headerH, contentW, headerH, 0.9);
    let cx = MARGIN;
    cols.forEach(c=>{
      d.line(cx, tableTop-headerH, cx, tableTop, 0.5);
      const lines = c.label.split("\n");
      lines.forEach((ln,i)=>d.centered(cx+c.w/2, tableTop-4*MM-(i*3.2*MM), ln, fBold, 6.6));
      cx += c.w;
    });

    let rowY = tableTop - headerH;
    const drawRow = (r:Row, bold=false) => {
      d.rect(MARGIN, rowY-rowH, contentW, rowH, 0.5);
      let x = MARGIN;
      const bt = r.m0+r.f0, et = r.m1+r.f1;
      const vals: (string|number)[] = [r.label, r.m0, r.f0, bt, r.transferredIn, r.transferredOut, r.droppedOut, r.m1, r.f1, et, r.ada, `${r.pct}%`];
      cols.forEach((c,i)=>{
        d.line(x, rowY-rowH, x, rowY, 0.35);
        if (i===0) d.text(x+2*MM, rowY-rowH+1.9*MM, String(vals[i]), bold?fBold:fReg, 7.6);
        else d.centered(x+c.w/2, rowY-rowH+1.9*MM, String(vals[i]), bold?fBold:fReg, 7.6);
        x += c.w;
      });
      rowY -= rowH;
    };
    rows.forEach(r=>drawRow(r));
    d.line(MARGIN, rowY, MARGIN+contentW, rowY, 0.9);
    drawRow(grand, true);
    d.line(MARGIN, rowY, MARGIN+contentW, rowY, 0.9);
    y = rowY - 6*MM;

    d.text(MARGIN, y, "Legend: Beg. = Enrolment at the beginning of the month · End = Enrolment at the end of the month · ADA = Average Daily Attendance", fReg, 7.5);
    y -= 4*MM;
    d.text(MARGIN, y, "Movement figures are drawn from each learner's recorded Enrollment Status; attendance figures are drawn from the Daily Attendance grid.", fReg, 7.5);
    y -= 10*MM;

    d.text(MARGIN, y, "Prepared by:", fReg, 8.5);
    d.line(MARGIN+28*MM, y-0.8, MARGIN+90*MM, y-0.8);
    d.text(MARGIN+150*MM, y, "Certified Correct:", fReg, 8.5);
    d.line(MARGIN+188*MM, y-0.8, MARGIN+contentW, y-0.8);
    y -= 4.5*MM;
    d.centered(MARGIN+59*MM, y, "SCHOOL REGISTRAR", fReg, 7.5);
    d.centered(MARGIN+150*MM+(contentW-188*MM+MARGIN)/2, y, "SCHOOL HEAD", fReg, 7.5);

    const pdfBytes = await pdfDoc.save();
    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SF4_${level}_${MONTH_NAMES[month]}_${year}.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
