// supabase/functions/generate-sf4/index.ts
//
// Generates School Form 4 (Monthly Learner's Movement and Attendance), for
// either Junior High School (Grades 7–10) or Senior High School (Grades
// 11–12, broken down by track), for one month — laid out to match the
// official LIS-generated SF4 (school_form_4_ver2014.2.1.1) column-for-column:
// one row per SECTION (with its adviser's name), Registered Learners /
// Attendance Daily Average / Attendance % for the Month all broken into
// Male / Female / Total, and NLPA / Transferred Out / Transferred In each
// broken into (A) Cumulative as of Previous Month, (B) For the Month, and
// (A+B) Cumulative as of End of the Month — again all M/F/T. A Mortality
// (Death) summary and grade-level + grand TOTAL rows follow, matching the
// paper form's own footer.
//
// "NLPA" = No Longer Participating in Learning Activities, the current
// DepEd term for what this app tracks as enrollment_status = 'Dropped Out'
// (DepEd Memo 014 s.2021 replaced "Dropout" with NLPA on this form).
//
// Movement figures come from profiles.enrollment_status + status_date.
// Attendance figures come from the daily_attendance grid, same as SF2.
//
// Cumulative figures assume a status, once set, isn't reversed later in the
// school year (true for the overwhelming majority of real cases) — so:
//   cumulative-as-of-end-of-month = count(status = X, status_date <= monthEnd)
//   for-the-month                 = count(status = X, monthStart <= status_date <= monthEnd)
//   cumulative-as-of-previous-month = cumulative-end - for-the-month
// If a learner's status is ever reverted (e.g. "Transferred Out" undone back
// to "Active"), these cumulative counts won't reflect that reversal — there's
// no history table backing enrollment_status, only its current value.
//
// Invoke: POST { level: "JHS" | "SHS", month, year, term }
// Returns: application/pdf binary

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-Encoding-Warning, X-Gender-Data-Warning",
};

const MM = 2.83465;
// Legal-size landscape (8.5in x 13in) — this table has 39 columns; A4 landscape
// isn't wide enough to keep them legible, and the source LIS export itself
// prints on long/legal bond paper.
const PAGE_W = 936;
const PAGE_H = 612;
const MARGIN = 8 * MM;

const SCHOOL_INFO = {
  region: "Region XI - Davao Region",
  division: "SCHOOLS DIVISION OF DAVAO CITY",
  school: "Maria Cristina P. Belcar Agricultural High School",
  schoolId: "304342",
  schoolYear: "2026 - 2027",
  schoolHead: "LYNDON MONTERON DUMAEL",
};

const MONTH_NAMES = ["","January","February","March","April","May","June","July","August","September","October","November","December"];

class Drawer {
  page: PDFPage; fReg: PDFFont; fBold: PDFFont;
  constructor(page: PDFPage, fReg: PDFFont, fBold: PDFFont) { this.page=page; this.fReg=fReg; this.fBold=fBold; }
  text(x:number,y:number,str:string,font:PDFFont,size:number) { this.page.drawText(str,{x,y,size,font,color:rgb(0,0,0)}); }
  centered(cx:number,y:number,str:string,font:PDFFont,size:number) {
    const w=font.widthOfTextAtSize(str,size); this.text(cx-w/2,y,str,font,size);
  }
  line(x1:number,y1:number,x2:number,y2:number,width=0.6) {
    this.page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:width,color:rgb(0,0,0)});
  }
}

// Greedy word-wrap: fits `text` into lines no wider than maxWidth at the given
// font/size. Column headers on this form (e.g. "TRANSFERRED OUT", "(A+B)
// Cum. End of Month") are too wide for a single 19pt-per-column cell, so
// without this they overlapped into the neighboring column and became
// unreadable — this is the fix for that.
function wrapLines(text:string, font:PDFFont, size:number, maxWidth:number): string[] {
  const words = text.replace(/\n/g," ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach(w => {
    const trial = line ? `${line} ${w}` : w;
    if (line && font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// ---- Column layout: 3 label columns (rowspan across the whole header) + ----
// ---- 12 "triples" of M/F/T, grouped exactly like the official SF4.      ----
type Triple = { topLabel:string; subLabel:string|null; dataKey:string };
const TRIPLES: Triple[] = [
  { topLabel:"REGISTERED LEARNERS",                      subLabel:"(End of the Month)",             dataKey:"reg" },
  { topLabel:"ATTENDANCE",                               subLabel:"Daily Average",                 dataKey:"ada" },
  { topLabel:"ATTENDANCE",                               subLabel:"% for the Month",                dataKey:"pct" },
  { topLabel:"NLPA",                                     subLabel:"(A) Cum. Prev. Month",           dataKey:"nlpaPrev" },
  { topLabel:"NLPA",                                     subLabel:"(B) For the Month",              dataKey:"nlpaMonth" },
  { topLabel:"NLPA",                                     subLabel:"(A+B) Cum. End of Month",        dataKey:"nlpaEnd" },
  { topLabel:"TRANSFERRED OUT",                          subLabel:"(A) Cum. Prev. Month",           dataKey:"toPrev" },
  { topLabel:"TRANSFERRED OUT",                          subLabel:"(B) For the Month",              dataKey:"toMonth" },
  { topLabel:"TRANSFERRED OUT",                          subLabel:"(A+B) Cum. End of Month",        dataKey:"toEnd" },
  { topLabel:"TRANSFERRED IN",                           subLabel:"(A) Cum. Prev. Month",           dataKey:"tiPrev" },
  { topLabel:"TRANSFERRED IN",                           subLabel:"(B) For the Month",              dataKey:"tiMonth" },
  { topLabel:"TRANSFERRED IN",                           subLabel:"(A+B) Cum. End of Month",        dataKey:"tiEnd" },
];
const LABEL_COLS = [
  { key:"grade", label:"GRADE/\nYEAR LEVEL", width:50 },
  { key:"section", label:"SECTION", width:46 },
  { key:"adviser", label:"NAME OF ADVISER", width:110 },
];
const NUM_COL_W = 19;

type RowData = {
  label: string; section?: string; adviser?: string;
  notEncoded?: boolean; // true only for a real section row with 0 attendance rows saved this month
  [key: string]: any;   // regM/regF/regT, adaM/adaF/adaT, pctM/pctF/pctT, nlpa*/to*/ti* (each M/F/T)
};

function zeroCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  TRIPLES.forEach(t => { out[`${t.dataKey}M`]=0; out[`${t.dataKey}F`]=0; out[`${t.dataKey}T`]=0; });
  return out;
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
    const gradeLabel = (g:number) => `Grade ${g}`;

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: allStudents }, { data: holidays }, { data: sectionsInScope }, { data: allDeceased }] = await Promise.all([
      adminClient.from("profiles").select("*").eq("role","student").in("grade_level",grades),
      adminClient.from("school_holidays").select("date"),
      adminClient.from("sections").select("id,name,grade_level,adviser_id").in("grade_level",grades),
      // Mortality is school-wide on the official form, not per grade/section — pull separately.
      adminClient.from("profiles").select("status_date").eq("role","student").eq("enrollment_status","Deceased"),
    ]);
    // Canonical calculation bridge: school dates and learner attendance totals
    // are now read from the same database functions used by the learner UI.
    const { data: dayRows, error: dayErr } = await adminClient.rpc("agrians_school_days", {
      p_month:month,p_year:year,p_term:term
    });
    if (dayErr) throw new Error(dayErr.message);
    const days = (dayRows||[]).map((r:any)=>String(r.date));

    const { data: calendarRow } = await adminClient.from("school_calendar")
      .select("school_days").eq("month",month).eq("year",year).eq("term",term).maybeSingle();
    const configuredSchoolDays = calendarRow?.school_days != null ? Number(calendarRow.school_days) : null;
    const actualSchoolDays = days.length;
    if (configuredSchoolDays != null && configuredSchoolDays !== actualSchoolDays) {
      return new Response(JSON.stringify({ error:
        `School calendar mismatch for ${MONTH_NAMES[month]} ${year}: Calendar is set to ${configuredSchoolDays} school days, `
        + `but the canonical SF4 date grid contains ${actualSchoolDays}. Add the missing non-school date(s) under School Calendar → Non-School Days, `
        + `or correct the monthly school-day count, then generate SF4 again.`
      }), { status:409, headers:{...corsHeaders,"Content-Type":"application/json"} });
    }
    const monthStart = days.length ? days[0] : `${year}-${String(month).padStart(2,"0")}-01`;
    const monthEnd = days.length ? days[days.length-1] : `${year}-${String(month).padStart(2,"0")}-28`;

    // Adviser names, for the "Name of Adviser" column.
    const adviserIds = [...new Set((sectionsInScope||[]).map(s=>s.adviser_id).filter(Boolean))];
    const { data: advisers } = adviserIds.length
      ? await adminClient.from("profiles").select("id,name").in("id", adviserIds)
      : { data: [] as {id:string;name:string}[] };
    const adviserNameById = new Map((advisers||[]).map(a=>[a.id,a.name]));

    const studentById = new Map((allStudents||[]).map(s=>[s.id, s]));
    const presentByStudent = new Map<string, number>();
    const encodedByStudent = new Map<string, boolean>();
    const sectionIds = [...new Set((sectionsInScope||[]).map(s=>s.id))];

    // The official SF4 template only has Male/Female columns — there is no
    // third column to print an "Other" count in. Rather than silently drop
    // these learners from every row (which previously made Total disagree
    // with Male + Female on a DepEd-facing form), keep counting them in the
    // Total column as before, but surface an explicit warning header so the
    // admin knows Total can exceed Male + Female and can fix the underlying
    // profile data (DepEd LIS requires every learner to have Male/Female set).
    const unclassifiedGenderCount = (allStudents||[]).filter(
      s => (s.enrollment_status==="Active"||s.enrollment_status==="Transferred In")
        && s.gender!=="Male" && s.gender!=="Female"
    ).length;

    // One canonical section summary per section. This avoids rebuilding the
    // attendance formula inside SF4 and guarantees SF4 uses the same totals as
    // the learner dashboard and audit RPC.
    for (const sectionId of sectionIds) {
      const { data: summaryRows, error: summaryErr } = await adminClient.rpc("agrians_section_attendance_summary", {
        p_section_id:sectionId,p_month:month,p_year:year,p_term:term
      });
      if (summaryErr) throw new Error(summaryErr.message);
      (summaryRows||[]).forEach((r:any)=>{
        presentByStudent.set(r.student_id, Number(r.total_present)||0);
        encodedByStudent.set(r.student_id, !!r.encoded);
      });
    }
    const sectionsWithAttendance = new Set<string>();
    (allStudents||[]).forEach(stu=>{ if(stu.section_id && encodedByStudent.get(stu.id)) sectionsWithAttendance.add(stu.section_id); });

    // (A)/(B)/(A+B) helper for one movement status across a group of students.
    const movementFigures = (group:any[], status:string) => {
      const flagged = group.filter(s=>s.enrollment_status===status && s.status_date);
      const end = flagged.filter(s=>s.status_date<=monthEnd);
      const forMonth = end.filter(s=>s.status_date>=monthStart && s.status_date<=monthEnd);
      const prevList = end.filter(s=>!(s.status_date>=monthStart && s.status_date<=monthEnd));
      const byGender = (list:any[], g:string) => list.filter(s=>s.gender===g).length;
      return {
        prevM:byGender(prevList,"Male"), prevF:byGender(prevList,"Female"), prevT:prevList.length,
        monthM:byGender(forMonth,"Male"), monthF:byGender(forMonth,"Female"), monthT:forMonth.length,
        endM:byGender(end,"Male"), endF:byGender(end,"Female"), endT:end.length,
      };
    };

    // Builds one row (a section, a grade subtotal, or the grand total) from a
    // group of student records. `sectionMeta` is only passed for real section
    // rows, and drives the "hasn't encoded attendance yet" exclusion.
    const buildRow = (label:string, group:any[], sectionMeta?: {name:string; adviser:string; id:string}): RowData => {
      const row: RowData = { label, ...zeroCounts() };
      if (sectionMeta) { row.section = sectionMeta.name; row.adviser = sectionMeta.adviser; }

      const currentlyEnrolled = group.filter(s=>s.enrollment_status==="Active"||s.enrollment_status==="Transferred In");
      const byGender = (list:any[], g:string) => list.filter(s=>s.gender===g).length;
      row.regM = byGender(currentlyEnrolled,"Male");
      row.regF = byGender(currentlyEnrolled,"Female");
      row.regT = currentlyEnrolled.length;

      // Attendance: only count learners whose section has actually saved a
      // Daily Attendance grid this month — see the module comment at the top
      // of generate-sf2 for why an un-saved section must not read as 0%.
      const notEncoded = !!sectionMeta && !sectionsWithAttendance.has(sectionMeta.id);
      row.notEncoded = notEncoded;
      const eligible = notEncoded ? [] : currentlyEnrolled.filter(s=>!s.section_id || sectionsWithAttendance.has(s.section_id));
      const presentSum = (list:any[]) => list.reduce((n,s)=>n+(presentByStudent.get(s.id)||0), 0);
      const eligM = eligible.filter(s=>s.gender==="Male"), eligF = eligible.filter(s=>s.gender==="Female");
      const presentM = presentSum(eligM), presentF = presentSum(eligF);
      row.adaM = days.length && eligM.length ? Math.round((presentM/days.length)*10)/10 : 0;
      row.adaF = days.length && eligF.length ? Math.round((presentF/days.length)*10)/10 : 0;
      row.adaT = Math.round((row.adaM+row.adaF)*10)/10;
      row.pctM = eligM.length && days.length ? Math.round((presentM/(eligM.length*days.length))*1000)/10 : 0;
      row.pctF = eligF.length && days.length ? Math.round((presentF/(eligF.length*days.length))*1000)/10 : 0;
      const eligTLen = eligM.length+eligF.length;
      row.pctT = eligTLen && days.length ? Math.round(((presentM+presentF)/(eligTLen*days.length))*1000)/10 : 0;

      (["Dropped Out","Transferred Out","Transferred In"] as const).forEach((status, i) => {
        const prefix = i===0 ? "nlpa" : i===1 ? "to" : "ti";
        const f = movementFigures(group, status);
        row[`${prefix}PrevM`]=f.prevM; row[`${prefix}PrevF`]=f.prevF; row[`${prefix}PrevT`]=f.prevT;
        row[`${prefix}MonthM`]=f.monthM; row[`${prefix}MonthF`]=f.monthF; row[`${prefix}MonthT`]=f.monthT;
        row[`${prefix}EndM`]=f.endM; row[`${prefix}EndF`]=f.endF; row[`${prefix}EndT`]=f.endT;
      });
      return row;
    };

    // Aggregates rows already built (grade subtotal / grand total) by summing
    // every raw count, then re-deriving ADA/% from the summed present/eligible
    // counts — never averaging percentages directly, which would misweight
    // sections of different sizes.
    const aggregateRows = (label:string, rows: RowData[]): RowData => {
      const row: RowData = { label, ...zeroCounts() };
      let presentM=0, presentF=0, eligM=0, eligF=0;
      rows.forEach(r => {
        TRIPLES.forEach(t => {
          if (["ada","pct"].includes(t.dataKey)) return; // re-derived below
          row[`${t.dataKey}M`] += r[`${t.dataKey}M`]||0;
          row[`${t.dataKey}F`] += r[`${t.dataKey}F`]||0;
          row[`${t.dataKey}T`] += r[`${t.dataKey}T`]||0;
        });
        if (!r.notEncoded) {
          presentM += Math.round((r.adaM||0)*days.length);
          presentF += Math.round((r.adaF||0)*days.length);
          eligM += r.regM||0;
          eligF += r.regF||0;
        }
      });
      row.adaM = days.length && eligM ? Math.round((presentM/days.length)*10)/10 : 0;
      row.adaF = days.length && eligF ? Math.round((presentF/days.length)*10)/10 : 0;
      row.adaT = Math.round((row.adaM+row.adaF)*10)/10;
      row.pctM = eligM && days.length ? Math.round((presentM/(eligM*days.length))*1000)/10 : 0;
      row.pctF = eligF && days.length ? Math.round((presentF/(eligF*days.length))*1000)/10 : 0;
      const eligT = eligM+eligF;
      row.pctT = eligT && days.length ? Math.round(((presentM+presentF)/(eligT*days.length))*1000)/10 : 0;
      return row;
    };

    // Build one row per section (grouped/ordered by grade), then a subtotal
    // row per grade, then the grand total — exactly matching the paper form.
    const sectionRows: RowData[] = [];
    const gradeSubtotals: RowData[] = [];
    const incompleteSections: string[] = [];

    grades.forEach(g => {
      const secsForGrade = (sectionsInScope||[]).filter(s=>s.grade_level===g);
      const rowsThisGrade: RowData[] = [];
      secsForGrade.forEach(sec => {
        const group = (allStudents||[]).filter(s=>s.section_id===sec.id);
        const adviserName = sec.adviser_id ? String(adviserNameById.get(sec.adviser_id) || "—") : "(no adviser assigned)";
        const row = buildRow(gradeLabel(g), group, { name: sec.name, adviser: adviserName, id: sec.id });
        if (row.notEncoded) incompleteSections.push(`${gradeLabel(g)} - ${sec.name}`);
        rowsThisGrade.push(row);
        sectionRows.push(row);
      });
      // Learners in this grade with no section assigned yet still belong in
      // the grade subtotal (registered/movement), though they contribute no
      // section-level attendance row of their own.
      const subtotalGroup = (allStudents||[]).filter(s=>s.grade_level===g);
      gradeSubtotals.push(
        rowsThisGrade.length
          ? aggregateRows(`${gradeLabel(g)} TOTAL`, rowsThisGrade)
          : buildRow(`${gradeLabel(g)} TOTAL`, subtotalGroup)
      );
    });
    const grandTotal = sectionRows.length ? aggregateRows("TOTAL", sectionRows) : buildRow("TOTAL", allStudents||[]);

    // Mortality (Death) — school-wide, not gendered, matching the form.
    const deceasedList = (allDeceased||[]).filter(s=>s.status_date);
    const mortEnd = deceasedList.filter(s=>s.status_date<=monthEnd).length;
    const mortMonth = deceasedList.filter(s=>s.status_date>=monthStart && s.status_date<=monthEnd).length;
    const mortPrev = mortEnd - mortMonth;

    // ---------------------------------------------------------------- PDF
    const pdfDoc = await PDFDocument.create();
    const fReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const d = new Drawer(page, fReg, fBold);
    const contentW = PAGE_W - 2*MARGIN;
    let y = PAGE_H - MARGIN;

    d.centered(PAGE_W/2, y, "SCHOOL FORM 4 (SF4) — MONTHLY LEARNER'S MOVEMENT AND ATTENDANCE", fBold, 11); y -= 5*MM;
    d.centered(PAGE_W/2, y, "DepEd standardized school form — movement, attendance, and mortality summary", fReg, 7.5); y -= 6*MM;

    d.text(MARGIN, y, `School ID: ${SCHOOL_INFO.schoolId}`, fReg, 8);
    d.text(MARGIN+150, y, SCHOOL_INFO.region, fReg, 8);
    d.text(MARGIN+300, y, SCHOOL_INFO.division, fReg, 8);
    y -= 4.5*MM;
    d.text(MARGIN, y, `School Name: ${SCHOOL_INFO.school}`, fReg, 8);
    y -= 4.5*MM;
    d.text(MARGIN, y, `School Year: ${SCHOOL_INFO.schoolYear}`, fReg, 8);
    d.text(MARGIN+150, y, `Report for the Month of: ${MONTH_NAMES[month]} ${year}`, fBold, 8.5);
    d.text(MARGIN+400, y, `Level: ${level==="JHS"?"Junior High School":"Senior High School"}`, fReg, 8);
    y -= 6*MM;

    // ---- Header (3 rows: top group / sub-group / M-F-T) ----
    const groupW = NUM_COL_W*3;
    const topFontSize = 7.5, subFontSize = 5.8, lineGap = 2.6*MM;

    // Consecutive triples sharing the same topLabel (e.g. the 3 NLPA triples,
    // or the 3 Transferred Out triples) are really ONE merged header cell on
    // the real form — draw the category name once across the full span
    // instead of once per triple, which is both truer to the form and far
    // more legible (more width per label = bigger font, no redundant repeats).
    type TopGroup = { label:string; startIdx:number; count:number };
    const topGroups: TopGroup[] = [];
    TRIPLES.forEach((t, i) => {
      const last = topGroups[topGroups.length-1];
      if (last && last.label===t.topLabel) last.count++;
      else topGroups.push({ label:t.topLabel, startIdx:i, count:1 });
    });
    const topGroupWrapped = topGroups.map(g => wrapLines(g.label, fBold, topFontSize, g.count*groupW-4));
    const subWrapped = TRIPLES.map(t => t.subLabel ? wrapLines(t.subLabel, fReg, subFontSize, groupW-3) : []);
    const labelWrapped = LABEL_COLS.map(col => wrapLines(col.label, fBold, 7, col.width-3));

    const maxTopLines = Math.max(1, ...topGroupWrapped.map(l=>l.length));
    const maxSubLines = Math.max(1, ...subWrapped.map(l=>l.length));
    const topRowH = maxTopLines*lineGap + 2*MM;
    const subRowH = maxSubLines*lineGap + 2*MM;
    const genderRowH = 4.5*MM;
    const headerRowH = [topRowH, subRowH, genderRowH];
    const topY = y, midY = y-headerRowH[0], botY = midY-headerRowH[1], headerBottomY = botY-headerRowH[2];

    let x = MARGIN;
    LABEL_COLS.forEach((col, ci) => {
      const lines = labelWrapped[ci];
      const totalH = headerRowH[0]+headerRowH[1]+headerRowH[2];
      let ly = topY - (totalH - lines.length*lineGap)/2 - lineGap*0.7;
      lines.forEach(line => { d.centered(x+col.width/2, ly, line, fBold, 7); ly -= lineGap; });
      d.line(x, topY, x, headerBottomY);
      x += col.width;
    });
    d.line(x, topY, x, headerBottomY);

    topGroups.forEach((g, gi) => {
      const span = g.count*groupW;
      const lines = topGroupWrapped[gi];
      let ly = topY - (topRowH - lines.length*lineGap)/2 - lineGap*0.7;
      lines.forEach(line => { d.centered(x+span/2, ly, line, fBold, topFontSize); ly -= lineGap; });
      x += span;
    });
    x = MARGIN + LABEL_COLS.reduce((s,c)=>s+c.width,0);

    TRIPLES.forEach((t, ti) => {
      const isGroupStart = topGroups.some(g => g.startIdx===ti);

      if (t.subLabel) {
        const sLines = subWrapped[ti];
        let sy = midY - (subRowH - sLines.length*lineGap)/2 - lineGap*0.7;
        sLines.forEach(line => { d.centered(x+groupW/2, sy, line, fReg, subFontSize); sy -= lineGap; });
      }
      ["M","F","T"].forEach((g,i) => {
        d.centered(x+i*NUM_COL_W+NUM_COL_W/2, headerBottomY+1.3*MM, g, fBold, 6.5);
        d.line(x+i*NUM_COL_W, topY, x+i*NUM_COL_W, headerBottomY);
      });
      // Thin divider between triples in the same merged group; thick
      // dividers at true category boundaries are drawn separately below.
      x += groupW;
      d.line(x, midY, x, headerBottomY, isGroupStart?0.6:0.4);
    });
    // Thick dividers at true category boundaries (Registered/Attendance/NLPA/…), full header height.
    let gx = MARGIN + LABEL_COLS.reduce((s,c)=>s+c.width,0);
    topGroups.forEach(g => { d.line(gx, topY, gx, headerBottomY, 1); gx += g.count*groupW; });
    d.line(gx, topY, gx, headerBottomY, 1);
    d.line(MARGIN, topY, x, topY);
    d.line(MARGIN, midY, x, midY);
    d.line(MARGIN, botY, x, botY);
    d.line(MARGIN, headerBottomY, x, headerBottomY);
    y = headerBottomY;

    // ---- Data rows ----
    const rowH = 4.6*MM;
    const drawDataRow = (row: RowData, opts: {bold?:boolean} = {}) => {
      y -= rowH;
      let cx = MARGIN;
      d.text(cx+2, y+1.4*MM, row.label, opts.bold?fBold:fReg, 6.8); cx += LABEL_COLS[0].width;
      d.text(cx+2, y+1.4*MM, row.section||"", opts.bold?fBold:fReg, 6.8); cx += LABEL_COLS[1].width;
      const adviserText = row.adviser || "";
      d.text(cx+2, y+1.4*MM, adviserText.length>26 ? adviserText.slice(0,25)+"…" : adviserText, opts.bold?fBold:fReg, 6.5);
      cx += LABEL_COLS[2].width;
      TRIPLES.forEach(t => {
        ["M","F","T"].forEach(g => {
          let val: string;
          if ((t.dataKey==="ada"||t.dataKey==="pct") && row.notEncoded) {
            val = "N/E";
          } else if (t.dataKey==="pct") {
            val = `${row[`${t.dataKey}${g}`]}%`;
          } else {
            val = String(row[`${t.dataKey}${g}`]);
          }
          d.centered(cx+NUM_COL_W/2, y+1.4*MM, val, opts.bold?fBold:fReg, 6.3);
          cx += NUM_COL_W;
        });
      });
      d.line(MARGIN, y, x, y);
    };

    grades.forEach(g => {
      const rowsForGrade = sectionRows.filter(r=>r.label===gradeLabel(g));
      rowsForGrade.forEach(r => drawDataRow(r));
      const subtotal = gradeSubtotals.find(r=>r.label===`${gradeLabel(g)} TOTAL`)!;
      drawDataRow(subtotal, { bold:true });
    });
    drawDataRow(grandTotal, { bold:true });
    d.line(MARGIN, y-rowH, x, y-rowH); // close the table
    y -= rowH;

    // ---- Mortality (Death) ----
    y -= 6*MM;
    d.text(MARGIN, y, "Mortality (Death)", fBold, 8); y -= 4.2*MM;
    d.text(MARGIN, y, `Previous Month/s: ${mortPrev}`, fReg, 7.5);
    d.text(MARGIN+130, y, `For the Month: ${mortMonth}`, fReg, 7.5);
    d.text(MARGIN+260, y, `Cumulative as of End of Month: ${mortEnd}`, fReg, 7.5);
    y -= 6*MM;

    // ---- Legend / completeness warning ----
    d.text(MARGIN, y, "NLPA = No Longer Participating in Learning Activities (formerly \"Dropout\"). Figures for Registered Learners, Attendance,", fReg, 7); y -= 3.4*MM;
    d.text(MARGIN, y, "NLPA, Transferred Out, and Transferred In are lifted from each section's SF2. \"N/E\" = attendance Not yet Encoded for this month.", fReg, 7); y -= 5*MM;

    let warningText = "";
    if (incompleteSections.length) {
      warningText = `${incompleteSections.length} section(s) have not yet encoded/saved attendance for `
        + `${MONTH_NAMES[month]} ${year}: ${incompleteSections.join(", ")}. Their ADA / % Attendance are marked N/E `
        + `until that section's SF2 is encoded — re-generate this report after.`;
      const maxWidth = contentW;
      const words = ("NOTE: " + warningText).split(" ");
      let line = "";
      words.forEach(w => {
        const trial = line ? line + " " + w : w;
        if (fBold.widthOfTextAtSize(trial, 7.5) > maxWidth) {
          d.text(MARGIN, y, line, fBold, 7.5); y -= 3.6*MM;
          line = w;
        } else {
          line = trial;
        }
      });
      if (line) { d.text(MARGIN, y, line, fBold, 7.5); y -= 3.6*MM; }
    }
    y -= 6*MM;

    // ---- Signature block ----
    d.text(MARGIN, y, "Prepared by:", fReg, 8);
    d.text(MARGIN+300, y, "Certified Correct:", fReg, 8); y -= 10*MM;
    d.line(MARGIN, y, MARGIN+220, y);
    d.line(MARGIN+300, y, MARGIN+520, y);
    d.centered(MARGIN+110, y-3.6*MM, "____________________________", fBold, 8);
    d.centered(MARGIN+410, y-3.6*MM, SCHOOL_INFO.schoolHead, fBold, 8.5);
    d.centered(MARGIN+110, y-7.2*MM, "Class Adviser / Authorized Personnel", fReg, 7);
    d.centered(MARGIN+410, y-7.2*MM, "School Head", fReg, 7);

    y -= 13*MM;
    d.text(MARGIN, y, `Form generated by AGRIANS • ${SCHOOL_INFO.school} • School Year ${SCHOOL_INFO.schoolYear}`, fReg, 6.5);

    const pdfBytes = await pdfDoc.save();
    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SF4_${level}_${MONTH_NAMES[month]}_${year}.pdf"`,
        ...(incompleteSections.length ? { "X-Encoding-Warning": encodeURIComponent(
          `${incompleteSections.length} section(s) not yet encoded — their ADA/% Attendance show as N/E: ${incompleteSections.join(", ")}`
        ) } : {}),
        ...(unclassifiedGenderCount > 0 ? { "X-Gender-Data-Warning": encodeURIComponent(
          `${unclassifiedGenderCount} enrolled learner(s) do not have Male/Female set as their gender. `
          + `They are included in the Total column but cannot appear in the Male/Female columns of this `
          + `report, so Male + Female will be less than Total. Update their profile's gender field.`
        ) } : {}),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
