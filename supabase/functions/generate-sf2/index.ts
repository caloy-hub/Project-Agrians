// supabase/functions/generate-sf2/index.ts
//
// Generates School Form 2 (Daily Attendance Report of Learners) for one
// section, for one month, using the daily_attendance grid encoded by the
// section adviser. Landscape A4, pdf-lib, built-in fonts.
//
// Invoke: POST { section_id, month, year, term }
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

// Same school-year calendar boundaries as the frontend's TERM_MONTHS.
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
  const out: {date:string; day:number}[] = [];
  for (let d=start; d<=end; d++) {
    const dow = new Date(year, month-1, d).getDay();
    if (dow===0||dow===6) continue;
    const iso = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (holidays.some(h=>h.date===iso)) continue;
    out.push({date:iso, day:d});
  }
  return out;
}

class Drawer {
  page: PDFPage; fReg: PDFFont; fBold: PDFFont;
  constructor(page: PDFPage, fReg: PDFFont, fBold: PDFFont) { this.page=page; this.fReg=fReg; this.fBold=fBold; }
  text(x:number,y:number,str:string,font:PDFFont,size:number) {
    this.page.drawText(str,{x,y,size,font,color:rgb(0,0,0)});
  }
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

    const { section_id, month, year, term } = await req.json();
    if (!section_id || !month || !year || !term) {
      return new Response(JSON.stringify({ error: "section_id, month, year, term are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: callerProfile } = await callerClient.from("profiles").select("role,id").eq("id",caller.id).single();
    const { data: section } = await adminClient.from("sections").select("*").eq("id",section_id).single();
    if (!section) {
      return new Response(JSON.stringify({ error: "Section not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authorized = callerProfile?.role==="admin" || section.adviser_id===caller.id;
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden: admin or this section's adviser only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [{ data: students }, { data: holidays }, adviser] = await Promise.all([
      adminClient.from("profiles").select("*").eq("role","student").eq("section_id",section_id).order("gender").order("name"),
      adminClient.from("school_holidays").select("date"),
      section.adviser_id
        ? adminClient.from("profiles").select("name").eq("id",section.adviser_id).single().then(r=>r.data)
        : Promise.resolve(null),
    ]);

    const days = schoolDaysInMonth(month, year, term, holidays||[]);
    const stuIds = (students||[]).map(s=>s.id);
    let dailyRows: {student_id:string; date:string; status:string}[] = [];
    if (stuIds.length && days.length) {
      const { data } = await adminClient.from("daily_attendance").select("*")
        .in("student_id", stuIds).gte("date", days[0].date).lte("date", days[days.length-1].date);
      dailyRows = data || [];
    }
    const statusFor = (studentId:string, date:string) => {
      const row = dailyRows.find(r=>r.student_id===studentId && r.date===date);
      return row ? row.status : "present"; // matches the adviser UI's default-present convention
    };

    const males = (students||[]).filter(s=>s.gender==="Male");
    const females = (students||[]).filter(s=>s.gender==="Female");
    const ordered = [...males, ...females];

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
    d.centered(PAGE_W/2, y, "SCHOOL FORM 2 (SF2) — DAILY ATTENDANCE REPORT OF LEARNERS", fBold, 12.5); y -= 7*MM;

    // Info line
    d.text(MARGIN, y, `Grade & Section: ${section.grade_level} - ${section.name}`, fBold, 9.5);
    d.text(MARGIN + 100*MM, y, `Month: ${MONTH_NAMES[month]} ${year}  (Term ${term})`, fBold, 9.5);
    d.text(MARGIN + 195*MM, y, `Adviser: ${adviser?.name || "—"}`, fBold, 9.5);
    y -= 6*MM;

    // ---- Grid ----
    const nameColW = 46*MM, totalColW = 12*MM;
    const contentW = PAGE_W - 2*MARGIN;
    const dayColW = days.length>0 ? (contentW - nameColW - totalColW*2) / days.length : 0;
    const rowH = 5.1*MM, headerH = 9*MM;
    const tableTop = y;

    // Header row
    d.rect(MARGIN, tableTop-headerH, contentW, headerH, 0.9);
    d.rect(MARGIN, tableTop-headerH, nameColW, headerH, 0.9);
    d.centered(MARGIN+nameColW/2, tableTop-headerH/2-1.2*MM, "Name of Learner", fBold, 7.5);
    let xh = MARGIN+nameColW;
    days.forEach(dd=>{
      d.line(xh, tableTop-headerH, xh, tableTop, 0.5);
      d.centered(xh+dayColW/2, tableTop-4*MM, String(dd.day), fBold, 6.5);
      xh += dayColW;
    });
    d.line(xh, tableTop-headerH, xh, tableTop, 0.9);
    d.centered(xh+totalColW/2, tableTop-headerH/2-1.2*MM, "Present", fBold, 6.8);
    d.line(xh+totalColW, tableTop-headerH, xh+totalColW, tableTop, 0.5);
    d.centered(xh+totalColW+totalColW/2, tableTop-headerH/2-1.2*MM, "Absent", fBold, 6.8);

    let rowY = tableTop - headerH;
    const drawGenderHeader = (label:string, count:number) => {
      d.rect(MARGIN, rowY-rowH, contentW, rowH, 0.6);
      d.text(MARGIN+2*MM, rowY-rowH+1.6*MM, `${label} (${count})`, fBold, 7.5);
      rowY -= rowH;
    };
    const drawStudentRow = (s:any) => {
      d.rect(MARGIN, rowY-rowH, contentW, rowH, 0.5);
      const nm = s.name.length>32 ? s.name.slice(0,31)+"…" : s.name;
      d.text(MARGIN+2*MM, rowY-rowH+1.6*MM, nm, fReg, 7.3);
      let x = MARGIN+nameColW, present=0;
      days.forEach(dd=>{
        d.line(x, rowY-rowH, x, rowY, 0.35);
        const st = statusFor(s.id, dd.date);
        if (st==="present") present++;
        d.centered(x+dayColW/2, rowY-rowH+1.6*MM, st==="present"?"":"X", fBold, 7);
        x += dayColW;
      });
      const absent = days.length - present;
      d.centered(x+totalColW/2, rowY-rowH+1.6*MM, String(present), fReg, 7.3);
      d.line(x+totalColW, rowY-rowH, x+totalColW, rowY, 0.5);
      d.centered(x+totalColW+totalColW/2, rowY-rowH+1.6*MM, String(absent), fReg, 7.3);
      rowY -= rowH;
      return {present, absent};
    };

    let totalPresent=0, totalAbsent=0;
    if (males.length) { drawGenderHeader("MALE", males.length); males.forEach(s=>{const r=drawStudentRow(s); totalPresent+=r.present; totalAbsent+=r.absent;}); }
    if (females.length) { drawGenderHeader("FEMALE", females.length); females.forEach(s=>{const r=drawStudentRow(s); totalPresent+=r.present; totalAbsent+=r.absent;}); }
    if (ordered.length===0) { d.rect(MARGIN, rowY-rowH, contentW, rowH, 0.5); d.text(MARGIN+2*MM, rowY-rowH+1.6*MM, "No learners in this section.", fReg, 8); rowY-=rowH; }

    d.line(MARGIN, rowY, MARGIN+contentW, rowY, 0.9);
    y = rowY - 6*MM;

    // ---- Summary box ----
    const enrolled = ordered.length;
    const totalSlots = enrolled*days.length;
    const attPct = totalSlots>0 ? Math.round((totalPresent/totalSlots)*1000)/10 : 0;
    const ada = days.length>0 ? Math.round((totalPresent/days.length)*10)/10 : 0;

    d.text(MARGIN, y, "SUMMARY FOR THE MONTH", fBold, 9.5); y -= 5.5*MM;
    const sumRows: [string,string][] = [
      ["Enrolment (Male / Female / Total)", `${males.length} / ${females.length} / ${enrolled}`],
      ["No. of School Days This Month", String(days.length)],
      ["Total Attendance for the Month (Learner-Days Present)", String(totalPresent)],
      ["Total Absences for the Month (Learner-Days Absent)", String(totalAbsent)],
      ["Percentage of Attendance for the Month", `${attPct}%`],
      ["Average Daily Attendance (ADA)", String(ada)],
    ];
    sumRows.forEach(([label,val])=>{
      d.text(MARGIN+2*MM, y, label, fReg, 8.3);
      d.text(MARGIN+120*MM, y, val, fBold, 8.3);
      y -= 5*MM;
    });

    y -= 3*MM;
    d.text(MARGIN, y, "Prepared by:", fReg, 8.5);
    d.line(MARGIN+28*MM, y-0.8, MARGIN+90*MM, y-0.8);
    d.text(MARGIN+150*MM, y, "Noted by:", fReg, 8.5);
    d.line(MARGIN+175*MM, y-0.8, MARGIN+contentW, y-0.8);
    y -= 4.5*MM;
    d.centered(MARGIN+59*MM, y, adviser?.name?.toUpperCase()||"CLASS ADVISER", fReg, 7.5);
    d.centered(MARGIN+150*MM+(contentW-175*MM+MARGIN)/2, y, "SCHOOL HEAD", fReg, 7.5);

    const pdfBytes = await pdfDoc.save();
    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SF2_${section.name.replace(/\s+/g,"_")}_${MONTH_NAMES[month]}_${year}.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
