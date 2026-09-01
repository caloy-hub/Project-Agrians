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

const MONTH_NAMES = ["","January","February","March","April","May","June","July","August","September","October","November","December"];

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

    const [{ data: students }, adviser] = await Promise.all([
      adminClient.from("profiles").select("*").eq("role","student").eq("section_id",section_id).order("gender").order("name"),
      section.adviser_id
        ? adminClient.from("profiles").select("name").eq("id",section.adviser_id).single().then(r=>r.data)
        : Promise.resolve(null),
    ]);

    // Canonical calculation bridge: the database owns the school-day grid and
    // attendance status expansion used by this PDF. The raw-row check below is
    // only an encoding/readiness check; it is not used to calculate totals.
    const { data: dayRows, error: dayErr } = await adminClient.rpc("agrians_school_days", {
      p_month:month,p_year:year,p_term:term
    });
    if (dayErr) throw new Error(dayErr.message);
    const days = (dayRows||[]).map((r:any)=>({date:String(r.date),day:Number(String(r.date).slice(8,10))}));
    const { data: gridRows, error: gridErr } = await adminClient.rpc("agrians_attendance_grid", {
      p_section_id:section_id,p_month:month,p_year:year,p_term:term
    });
    if (gridErr) throw new Error(gridErr.message);
    const gridByKey = new Map<string,string>((gridRows||[]).map((r:any)=>[`${r.student_id}|${r.date}`,r.status]));
    const stuIds = (students||[]).map(s=>s.id);
    const { data: rawRows } = stuIds.length
      ? await adminClient.from("daily_attendance").select("student_id,date").in("student_id",stuIds)
        .gte("date",`${year}-${String(month).padStart(2,"0")}-01`).lte("date",`${year}-${String(month).padStart(2,"0")}-31`)
      : {data:[] as any[]};
    const encoded = (rawRows||[]).some((r:any)=>days.some((d:any)=>d.date===r.date));
    if (days.length>0 && stuIds.length>0 && !encoded) {
      return new Response(JSON.stringify({ error:
        `Attendance for ${section.name} has not been encoded for ${MONTH_NAMES[month]} ${year} yet. `
        + `Ask the section adviser to encode and save the Daily Attendance grid first, then generate SF2 again.`
      }), { status:400, headers:{...corsHeaders,"Content-Type":"application/json"} });
    }

    const statusFor = (studentId:string, date:string) => gridByKey.get(`${studentId}|${date}`) || "present";
    const males = (students||[]).filter(s=>s.gender==="Male");
    const females = (students||[]).filter(s=>s.gender==="Female");
    const ordered = [...males, ...females];

    const pdfDoc = await PDFDocument.create();
    const fReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const nameColW = 46*MM, totalColW = 12*MM;
    const contentW = PAGE_W - 2*MARGIN;
    const dayColW = days.length>0 ? (contentW - nameColW - totalColW*2) / days.length : 0;
    const rowH = 5.1*MM, headerH = 9*MM;

    let totalPresent=0, totalAbsent=0;
    let pageNo=0;

    const drawGridPage = (pageStudents:any[], showPageLabel=false) => {
      pageNo++;
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      const d = new Drawer(page, fReg, fBold);
      let y = PAGE_H - MARGIN;

      d.centered(PAGE_W/2, y, "Department of Education", fBold, 11); y -= 4.6*MM;
      d.centered(PAGE_W/2, y, `${SCHOOL_INFO.region}  ·  ${SCHOOL_INFO.division}`, fReg, 9); y -= 4.4*MM;
      d.centered(PAGE_W/2, y, SCHOOL_INFO.school, fBold, 11); y -= 4.6*MM;
      d.centered(PAGE_W/2, y, `School ID: ${SCHOOL_INFO.schoolId}`, fReg, 8.5); y -= 6*MM;
      d.centered(PAGE_W/2, y, "SCHOOL FORM 2 (SF2) — DAILY ATTENDANCE REPORT OF LEARNERS", fBold, 12.5); y -= 7*MM;

      d.text(MARGIN, y, `Grade & Section: ${section.grade_level} - ${section.name}`, fBold, 9.5);
      d.text(MARGIN + 100*MM, y, `Month: ${MONTH_NAMES[month]} ${year}  (Term ${term})`, fBold, 9.5);
      d.text(MARGIN + 195*MM, y, `Adviser: ${adviser?.name || "—"}`, fBold, 9.5);
      if (showPageLabel) d.text(PAGE_W-MARGIN-34*MM, y, `Page ${pageNo}`, fReg, 8);
      y -= 6*MM;

      const tableTop = y;
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
        totalPresent += present; totalAbsent += absent;
      };

      let used=0;
      const maxRows = Math.max(1, Math.floor((tableTop-headerH-(MARGIN+6*MM))/rowH));
      let lastGender="";
      for (const s of pageStudents) {
        const gender = s.gender==="Male" ? "MALE" : "FEMALE";
        if (gender!==lastGender) {
          drawGenderHeader(gender, pageStudents.filter(x=>(x.gender==="Male"?"MALE":"FEMALE")===gender).length);
          lastGender=gender; used++;
        }
        drawStudentRow(s); used++;
      }
      d.line(MARGIN, rowY, MARGIN+contentW, rowY, 0.9);
      return {maxRows,used};
    };

    // Paginate the daily grid dynamically. The summary/certification is always
    // placed on its own final page, so a large section naturally becomes 3+
    // pages without ever pushing the computation/signature block off-page.
    // With the current A4-landscape geometry, 26 learner rows plus a gender
    // header fit safely on one grid page. Keep this explicit and conservative
    // so the table never collides with the footer/margin.
    const maxStudentRowsPerGridPage = 26;
    let remaining = [...ordered];
    let firstPage=true;
    while (remaining.length) {
      // Prefer not to split a gender group when it fits, but never let a large
      // group overflow a page.
      let take = Math.min(maxStudentRowsPerGridPage, remaining.length);
      if (take < remaining.length) {
        const boundary = remaining[take-1]?.gender;
        const nextGender = remaining[take]?.gender;
        if (boundary===nextGender && take>8) take--;
      }
      const chunk=remaining.slice(0,take);
      drawGridPage(chunk,!firstPage);
      remaining=remaining.slice(take);
      firstPage=false;
    }
    if (!ordered.length) drawGridPage([],false);

    // ---- Final page: monthly summary + computation/signatures ----
    const page2 = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const d2 = new Drawer(page2, fReg, fBold);
    let y2 = PAGE_H - MARGIN;

    d2.centered(PAGE_W/2, y2, "Department of Education", fBold, 11); y2 -= 4.6*MM;
    d2.centered(PAGE_W/2, y2, `${SCHOOL_INFO.region}  ·  ${SCHOOL_INFO.division}`, fReg, 9); y2 -= 4.4*MM;
    d2.centered(PAGE_W/2, y2, SCHOOL_INFO.school, fBold, 11); y2 -= 4.6*MM;
    d2.centered(PAGE_W/2, y2, "SCHOOL FORM 2 (SF2) — SUMMARY FOR THE MONTH", fBold, 12.5); y2 -= 7*MM;
    d2.text(MARGIN, y2, `Grade & Section: ${section.grade_level} - ${section.name}`, fBold, 9.5);
    d2.text(MARGIN + 100*MM, y2, `Month: ${MONTH_NAMES[month]} ${year}  (Term ${term})`, fBold, 9.5);
    d2.text(MARGIN + 195*MM, y2, `Adviser: ${adviser?.name || "—"}`, fBold, 9.5);
    y2 -= 10*MM;

    const enrolled = ordered.length;
    const totalSlots = enrolled*days.length;
    const attPct = totalSlots>0 ? Math.round((totalPresent/totalSlots)*1000)/10 : 0;
    const ada = days.length>0 ? Math.round((totalPresent/days.length)*10)/10 : 0;

    d2.text(MARGIN, y2, "SUMMARY FOR THE MONTH", fBold, 10); y2 -= 6.5*MM;
    const sumRows: [string,string][] = [
      ["Enrolment (Male / Female / Total)", `${males.length} / ${females.length} / ${enrolled}`],
      ["No. of School Days This Month", String(days.length)],
      ["Total Attendance for the Month (Learner-Days Present)", String(totalPresent)],
      ["Total Absences for the Month (Learner-Days Absent)", String(totalAbsent)],
      ["Percentage of Attendance for the Month", `${attPct}%`],
      ["Average Daily Attendance (ADA)", String(ada)],
    ];
    sumRows.forEach(([label,val])=>{
      d2.text(MARGIN+2*MM, y2, label, fReg, 9.5);
      d2.text(MARGIN+140*MM, y2, val, fBold, 9.5);
      y2 -= 6.5*MM;
    });

    y2 -= 10*MM;
    d2.text(MARGIN, y2, "Prepared by:", fReg, 8.5);
    d2.line(MARGIN+28*MM, y2-0.8, MARGIN+90*MM, y2-0.8);
    d2.text(MARGIN+150*MM, y2, "Noted by:", fReg, 8.5);
    d2.line(MARGIN+175*MM, y2-0.8, MARGIN+contentW, y2-0.8);
    y2 -= 4.5*MM;
    d2.centered(MARGIN+59*MM, y2, adviser?.name?.toUpperCase()||"CLASS ADVISER", fReg, 7.5);
    d2.centered(MARGIN+150*MM+(contentW-175*MM+MARGIN)/2, y2, "SCHOOL HEAD", fReg, 7.5);

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
