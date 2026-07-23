// supabase/functions/generate-sf9/index.ts
//
// Generates a filled-in SF9 (Learner's Performance Report) PDF for a single
// student, pulling real data from Supabase (profile, grades, attendance,
// school_calendar) and rendering it with the exact layout finalized for
// AGRIANS / MCPBAHS (A4 landscape, two-column DepEd template).
//
// Uses pdf-lib (Deno-compatible) with built-in Times-Roman fonts (no custom
// font embedding needed). DepEd seal and school logo are fetched from
// Supabase Storage and embedded as PNGs.
//
// Invoke: POST { student_id: string }
// Returns: application/pdf binary

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
  PDFImage,
} from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- CONSTANTS (mirrors generate_sf9_v2.py) ----------
const MM = 2.83465; // 1mm in PDF points
const PAGE_W = 841.89; // A4 landscape width in points (297mm)
const PAGE_H = 595.28; // A4 landscape height in points (210mm)
const MARGIN = 10 * MM;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const GUTTER = 8 * MM;
const COL_W = (CONTENT_W - GUTTER) / 2;

const SCHOOL_INFO = {
  region: "Region XI",
  division: "SCHOOLS DIVISION OF DAVAO CITY",
  cluster: "Cluster 9 Secondary Schools",
  district: "Baguio District, Davao City",
  school: "Maria Cristina P. Belcar Agricultural High School",
};

const DESCRIPTORS: [string, string, string][] = [
  ["90-100", "Advancing", "Passed"],
  ["80-89", "Benchmarking", "Passed"],
  ["75-79", "Connecting", "Passed"],
  ["65-74", "Developing", "Failed"],
  ["0-64", "Emerging", "Failed"],
];

const MONTHS = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
const MONTH_YEAR_OFFSET: Record<string, number> = {
  Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0,
  Jan: 1, Feb: 1, Mar: 1, Apr: 1,
};

function getSubjectOrder(gradeLevel: number | null, tveQualification: string | null): string[] {
  const g = gradeLevel;
  const tveLabel = tveQualification ? `TVE (${tveQualification})` : "TVE";
  const subjects = [
    "Filipino", "English", "Mathematics", "Science",
    "Araling Panlipunan", "Values Education", tveLabel,
    "MAPEH", "    Music and Arts", "    PE and Health",
  ];
  if (g === 7 || g === 8) subjects.push("Technical Drawing");
  if (g === 9 || g === 10) subjects.push("Entrepreneurship");
  if (g === 7 || g === 8 || g === 9) subjects.push("ICF");
  return subjects;
}

// Senior High (Grades 11–12) has no fixed DepEd subject list the way JHS
// does — subjects differ by track/strand and even by term/semester (a
// school might only have Term 1 subjects encoded so far, then add Term 2
// subjects later). So instead of a hardcoded array, the SHS line items are
// built straight from whatever `subjects` rows exist for that grade level
// (optionally scoped to the student's own section), in the order they were
// created. Add a new subject any time and it just shows up next time this
// is generated — no code change needed.
function getSubjectOrderSHS(subjects: any[], student: any): string[] {
  const applicable = subjects.filter((s: any) =>
    !s.parent_subject_id && (!s.section_id || s.section_id === student.section_id)
  );
  applicable.sort((a: any, b: any) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.name).localeCompare(String(b.name));
  });
  const out: string[] = [];
  for (const sub of applicable) {
    out.push(sub.name);
    const children = subjects
      .filter((s: any) => s.parent_subject_id === sub.id)
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    for (const c of children) out.push("    " + c.name);
  }
  return out;
}

function remarkFor(grade: number | null): string {
  if (grade === null || isNaN(grade)) return "";
  if (grade >= 75) return "Passed";
  return "Failed";
}

// ---------- DRAW HELPERS ----------
class Drawer {
  page: PDFPage;
  fReg: PDFFont;
  fBold: PDFFont;
  fIt: PDFFont;
  fBI: PDFFont;

  constructor(page: PDFPage, fReg: PDFFont, fBold: PDFFont, fIt: PDFFont, fBI: PDFFont) {
    this.page = page;
    this.fReg = fReg;
    this.fBold = fBold;
    this.fIt = fIt;
    this.fBI = fBI;
  }

  text(x: number, y: number, str: string, font: PDFFont, size: number) {
    this.page.drawText(str, { x, y, size, font, color: rgb(0, 0, 0) });
  }

  centered(cx: number, y: number, str: string, font: PDFFont, size: number) {
    const w = font.widthOfTextAtSize(str, size);
    this.text(cx - w / 2, y, str, font, size);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.8) {
    this.page.drawLine({
      start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
      thickness: width, color: rgb(0, 0, 0),
    });
  }

  rect(x: number, y: number, w: number, h: number, width = 0.9) {
    this.page.drawRectangle({
      x, y, width: w, height: h,
      borderColor: rgb(0, 0, 0), borderWidth: width, opacity: 0,
    });
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number) {
    this.page.drawImage(img, { x, y, width: w, height: h });
  }

  wrapped(
    text: string, x0: number, y: number, maxWidth: number, font: PDFFont,
    size: number, leading: number, indentFirst = 0,
  ): number {
    const words = text.split(" ");
    let line = "";
    let firstLine = true;
    for (const w of words) {
      const test = (line + " " + w).trim();
      const avail = maxWidth - (firstLine ? indentFirst : 0);
      if (font.widthOfTextAtSize(test, size) > avail && line) {
        this.text(x0 + (firstLine ? indentFirst : 0), y, line, font, size);
        y -= leading;
        line = w;
        firstLine = false;
      } else {
        line = test;
      }
    }
    if (line) {
      this.text(x0 + (firstLine ? indentFirst : 0), y, line, font, size);
      y -= leading;
    }
    return y;
  }

  shrinkToFit(text: string, font: PDFFont, startSize: number, maxWidth: number, minSize = 5.5): number {
    let size = startSize;
    while (font.widthOfTextAtSize(text, size) > maxWidth && size > minSize) {
      size -= 0.2;
    }
    return size;
  }
}

// ---------- MAIN HANDLER ----------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { student_id, school_year } = body;
    if (!student_id) {
      return new Response(JSON.stringify({ error: "student_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---------- Permission check: caller must be admin, OR the adviser of
    // this student's section, OR a teacher who teaches this student. ----------
    const { data: callerProfile } = await callerClient
      .from("profiles").select("role, id").eq("id", caller.id).single();

    const { data: student, error: studentErr } = await adminClient
      .from("profiles").select("*").eq("id", student_id).eq("role", "student").single();

    if (studentErr || !student) {
      return new Response(JSON.stringify({ error: "Student not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let authorized = callerProfile?.role === "admin";
    if (!authorized && callerProfile?.role === "teacher") {
      const { data: section } = await adminClient
        .from("sections").select("adviser_id").eq("id", student.section_id).maybeSingle();
      if (section?.adviser_id === caller.id) authorized = true;
      if (!authorized) {
        const { data: teaches } = await adminClient
          .from("subjects").select("id")
          .eq("teacher_id", caller.id).eq("grade_level", student.grade_level).limit(1);
        if (teaches && teaches.length > 0) authorized = true;
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden: not authorized for this student" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- Fetch related data ----------
    const [sectionRes, subjectsRes, gradesRes, attendanceRes, calendarRes] = await Promise.all([
      adminClient.from("sections").select("*").eq("id", student.section_id).maybeSingle(),
      adminClient.from("subjects").select("*").eq("grade_level", student.grade_level),
      adminClient.from("grades").select("*").eq("student_id", student_id),
      adminClient.from("attendance").select("*").eq("student_id", student_id),
      adminClient.from("school_calendar").select("*"),
    ]);

    const section = sectionRes.data;
    const subjects = subjectsRes.data || [];
    const grades = gradesRes.data || [];
    const attendance = attendanceRes.data || [];
    const calendar = calendarRes.data || [];

    const subjectById: Record<string, any> = {};
    for (const s of subjects) subjectById[s.id] = s;

    // grade lookup: subjectName -> { 1: val, 2: val, 3: val }
    const gradeMap: Record<string, Record<number, number>> = {};
    for (const g of grades) {
      const subj = subjectById[g.subject_id];
      if (!subj) continue;
      if (!gradeMap[subj.name]) gradeMap[subj.name] = {};
      gradeMap[subj.name][g.term] = g.grade;
    }

    // attendance lookup: month -> {present, schoolDays}
    const attByMonth: Record<string, { present: number; total: number }> = {};
    for (const a of attendance) {
      const cal = calendar.find((c: any) => c.month === a.month && c.year === a.year && c.term === a.term);
      const total = cal?.school_days || 0;
      attByMonth[a.month] = { present: (attByMonth[a.month]?.present || 0) + (a.days_present || 0), total: (attByMonth[a.month]?.total || 0) + total };
    }

    // ---------- Build PDF ----------
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    const fReg = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const fBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const fIt = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    const fBI = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

    const d = new Drawer(page, fReg, fBold, fIt, fBI);

    // Logos (fetched from Supabase Storage public bucket "branding")
    let depedImg: PDFImage | null = null;
    let schoolImg: PDFImage | null = null;
    try {
      const depedBytes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/branding/deped_seal.png`,
      ).then((r) => r.arrayBuffer());
      depedImg = await pdfDoc.embedPng(depedBytes);
    } catch (_e) { /* logo optional */ }
    try {
      const schoolBytes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/branding/school_logo.png`,
      ).then((r) => r.arrayBuffer());
      schoolImg = await pdfDoc.embedPng(schoolBytes);
    } catch (_e) { /* logo optional */ }

    d.rect(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, 1.3);

    // ============ LEFT COLUMN ============
    const leftX0 = MARGIN;
    let y = PAGE_H - MARGIN - 5 * MM;

    // Header
    {
      const sealR = 9 * MM;
      if (depedImg) d.image(depedImg, leftX0, y - 2 * sealR, sealR * 2, sealR * 2);
      const tx = leftX0 + 23 * MM;
      const textW = COL_W - 23 * MM - 21 * MM;
      const cx = tx + textW / 2;

      d.centered(cx, y - 1.8 * MM, "Republic of the Philippines", fBold, 9.5);
      d.centered(cx, y - 6.1 * MM, "Department of Education", fReg, 8.8);
      d.centered(cx, y - 10.7 * MM, SCHOOL_INFO.region, fReg, 7.7);
      d.centered(cx, y - 14.4 * MM, SCHOOL_INFO.division, fBold, 8.2);
      d.centered(cx, y - 18.1 * MM, SCHOOL_INFO.cluster, fReg, 7.7);
      d.centered(cx, y - 21.8 * MM, SCHOOL_INFO.district, fReg, 7.7);

      const logoR = 9 * MM;
      const logo2X = leftX0 + COL_W - 10 * MM - logoR;
      const logo2Y = y - 11 * MM - logoR;
      if (schoolImg) d.image(schoolImg, logo2X, logo2Y, logoR * 2, logoR * 2);

      const sy = y - 27.5 * MM;
      d.text(leftX0, sy, "School:", fReg, 8.5);
      d.text(leftX0 + 12 * MM, sy, SCHOOL_INFO.school, fBold, 8.5);
      y = sy - 6.8 * MM;
    }

    // Title
    {
      const cx = leftX0 + COL_W / 2;
      d.centered(cx, y, "LEARNER'S PERFORMANCE REPORT", fBold, 15);
      d.centered(cx, y - 5.5 * MM, `School Year ${school_year || ""}`, fReg, 9);
      y -= 11.5 * MM;
    }

    // Learner info
    {
      const lineH = 5.4 * MM;
      d.text(leftX0, y, "Name:", fReg, 9);
      d.line(leftX0 + 12 * MM, y - 0.8, leftX0 + 60 * MM, y - 0.8);
      d.text(leftX0 + 12 * MM, y + 1.2, student.name || "", fReg, 9);
      d.text(leftX0 + 63 * MM, y, "Age:", fReg, 9);
      d.line(leftX0 + 71 * MM, y - 0.8, leftX0 + 86 * MM, y - 0.8);
      const age = student.birthday ? computeAge(student.birthday) : "";
      d.text(leftX0 + 71 * MM, y + 1.2, String(age), fReg, 9);
      d.text(leftX0 + 89 * MM, y, "Sex:", fReg, 9);
      d.line(leftX0 + 97 * MM, y - 0.8, leftX0 + COL_W, y - 0.8);
      d.text(leftX0 + 97 * MM, y + 1.2, student.gender || "", fReg, 9);
      y -= lineH;

      d.text(leftX0, y, "LRN:", fReg, 9);
      d.line(leftX0 + 12 * MM, y - 0.8, leftX0 + 60 * MM, y - 0.8);
      d.text(leftX0 + 12 * MM, y + 1.2, student.lrn || "", fReg, 9);
      d.text(leftX0 + 63 * MM, y, "Grade:", fReg, 9);
      d.line(leftX0 + 73 * MM, y - 0.8, leftX0 + 86 * MM, y - 0.8);
      d.text(leftX0 + 73 * MM, y + 1.2, String(student.grade_level || ""), fReg, 9);
      d.text(leftX0 + 89 * MM, y, "Section:", fReg, 9);
      d.line(leftX0 + 100 * MM, y - 0.8, leftX0 + COL_W, y - 0.8);
      d.text(leftX0 + 100 * MM, y + 1.2, section?.name || "", fReg, 9);
      y -= lineH;

      d.text(leftX0, y, "Track (SHS only):", fReg, 9);
      d.line(leftX0 + 31 * MM, y - 0.8, leftX0 + 72 * MM, y - 0.8);
      if (student.shs_track) {
        d.text(leftX0 + 31 * MM, y + 1.2, student.shs_track, fReg, 8.5);
      }
      y -= lineH * 1.3;
    }

    // Dear Parents
    {
      d.text(leftX0, y, "Dear Parents,", fBold, 9);
      y -= 4.6 * MM;
      const t1 = "This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values.";
      const t2 = "The school welcomes you should you desire to know more about your child's progress.";
      y = d.wrapped(t1, leftX0, y, COL_W, fReg, 8.2, 3.9 * MM, 5.5 * MM);
      y -= 0.6 * MM;
      y = d.wrapped(t2, leftX0, y, COL_W, fReg, 8.2, 3.9 * MM, 5.5 * MM);
      y -= 3.2 * MM;
    }

    // Grades table
    {
      d.text(leftX0, y, "LEARNING PROGRESS AND ACHIEVEMENT", fBold, 9.5);
      let yTop = y - 4.4 * MM;

      const colSubjectW = 40 * MM;
      const colTermW = 11.5 * MM;
      const colFinalW = 15 * MM;
      const colRemarksW = COL_W - colSubjectW - 3 * colTermW - colFinalW;
      const headerH = 8.0 * MM;

      const isSHS = student.grade_level === 11 || student.grade_level === 12;
      const subjectsOrder = isSHS
        ? getSubjectOrderSHS(subjects, student)
        : getSubjectOrder(student.grade_level, student.tve_qualification);
      const nRows = subjectsOrder.length + 1;
      const TARGET_ROWS = 13;
      const TARGET_ROW_H = 4.0 * MM;
      const targetTableH = headerH + TARGET_ROW_H * TARGET_ROWS;
      const rowH = (targetTableH - headerH) / nRows;
      const tableH = headerH + rowH * nRows;

      const xSubject = leftX0;
      const xT1 = xSubject + colSubjectW;
      const xT2 = xT1 + colTermW;
      const xT3 = xT2 + colTermW;
      const xFinal = xT3 + colTermW;
      const xRemarks = xFinal + colFinalW;
      const xEnd = xRemarks + colRemarksW;

      const yBottom = yTop - tableH;

      d.rect(xSubject, yBottom, xEnd - xSubject, tableH, 0.9);
      const genAvgRowTop = yBottom + rowH;
      for (const x of [xT1, xT2, xT3]) d.line(x, genAvgRowTop, x, yTop, 0.6);
      d.line(xFinal, yBottom, xFinal, yTop, 0.6);
      d.line(xRemarks, yBottom, xRemarks, yTop, 0.6);

      d.line(xSubject, yTop - headerH, xEnd, yTop - headerH, 0.6);
      d.line(xT1, yTop - 3.8 * MM, xFinal, yTop - 3.8 * MM, 0.6);

      d.centered((xSubject + xT1) / 2, yTop - 6 * MM, "Learning Areas", fBold, 8);
      d.centered((xT1 + xFinal) / 2, yTop - 2.7 * MM, "TERM", fBold, 8);
      d.centered((xT1 + xT2) / 2, yTop - 7 * MM, "1", fBold, 7.6);
      d.centered((xT2 + xT3) / 2, yTop - 7 * MM, "2", fBold, 7.6);
      d.centered((xT3 + xFinal) / 2, yTop - 7 * MM, "3", fBold, 7.6);
      d.centered((xFinal + xRemarks) / 2, yTop - 4 * MM, "Final", fBold, 7);
      d.centered((xFinal + xRemarks) / 2, yTop - 7 * MM, "Grade", fBold, 7);
      d.centered((xRemarks + xEnd) / 2, yTop - 6 * MM, "Remarks", fBold, 8);

      let yRow = yTop - headerH;
      const termSums = [0, 0, 0];
      const termCounts = [0, 0, 0];

      for (const subj of subjectsOrder) {
        const yRowBot = yRow - rowH;
        d.line(xSubject, yRowBot, xEnd, yRowBot, 0.6);
        const isSub = subj.trim() !== subj && subj.trim() !== "";
        const label = subj.trim();
        if (label) {
          const font = isSub ? fIt : fReg;
          let size = isSub ? 7.5 : 7.8;
          const indent = isSub ? 3.2 * MM : 1.6 * MM;
          const availW = colSubjectW - indent - 1 * MM;
          size = d.shrinkToFit(label, font, size, availW);
          d.text(xSubject + indent, yRowBot + 2 * MM, label, font, size);

          // Use the base subject name for the grade lookup (matches
          // subjects.name in the database), not the display label, since
          // the TVE row's label includes "(Qualification)" for display only.
          const lookupName = label.startsWith("TVE") ? "TVE" : label;

          // If this label matches a subject that has components (e.g.
          // MAPEH's PE and Health / Music and Arts, or any similar setup
          // in SHS), its value is always the average of whichever
          // components have a grade for that term — never a directly
          // encoded grade of its own.
          const parentSubj = subjects.find((s: any) => s.name === label && !s.parent_subject_id);
          const childSubjs = parentSubj
            ? subjects.filter((s: any) => s.parent_subject_id === parentSubj.id)
            : [];
          let g: Record<number, number> = {};
          if (childSubjs.length > 0) {
            for (let t = 1; t <= 3; t++) {
              const vals = childSubjs
                .map((c: any) => gradeMap[c.name]?.[t])
                .filter((v: any) => v !== undefined && v !== null) as number[];
              if (vals.length) g[t] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
            }
          } else {
            g = gradeMap[lookupName] || {};
          }

          let final: number | null = null;
          let count = 0, sum = 0;
          for (let t = 1; t <= 3; t++) {
            const val = g[t];
            const colX = t === 1 ? xT1 : t === 2 ? xT2 : xT3;
            const colXEnd = t === 1 ? xT2 : t === 2 ? xT3 : xFinal;
            if (val !== undefined && val !== null) {
              d.centered((colX + colXEnd) / 2, yRowBot + 2 * MM, String(val), fReg, 7.6);
              sum += val; count++;
              if (!isSub) { termSums[t - 1] += val; termCounts[t - 1] += 1; }
            }
          }
          if (count > 0) {
            final = Math.round((sum / count) * 100) / 100;
            d.centered((xFinal + xRemarks) / 2, yRowBot + 2 * MM, String(final), fReg, 7.6);
            const remark = remarkFor(final);
            d.centered((xRemarks + xEnd) / 2, yRowBot + 2 * MM, remark, fReg, 7.6);
          }
        }
        yRow = yRowBot;
      }

      // General Average row
      const yRowBot = yRow - rowH;
      d.line(xSubject, yRowBot + rowH, xEnd, yRowBot + rowH, 0.9);
      d.centered((xSubject + xFinal) / 2, yRowBot + 2 * MM, "General Average", fBI, 7.9);

      const validTermAvgs = termSums.map((s, i) => (termCounts[i] > 0 ? s / termCounts[i] : null)).filter((v) => v !== null) as number[];
      if (validTermAvgs.length > 0) {
        const overallAvg = Math.round((validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length) * 100) / 100;
        d.centered((xFinal + xRemarks) / 2, yRowBot + 2 * MM, String(overallAvg), fBold, 8);
      }

      y = yBottom - 4.2 * MM;
    }

    // Performance descriptors
    {
      d.text(leftX0, y, "PERFORMANCE DESCRIPTORS", fBold, 9);
      y -= 5.2 * MM;
      const col1 = leftX0 + 6 * MM;
      const col2 = col1 + 27 * MM;
      const col3 = col2 + 33 * MM;
      d.text(col1, y, "Grading Scale", fBold, 7.8);
      d.text(col2, y, "Description", fBold, 7.8);
      d.text(col3, y, "Remarks", fBold, 7.8);
      y -= 3.8 * MM;
      for (const [scale, desc, remark] of DESCRIPTORS) {
        d.text(col1, y, scale, fReg, 7.6);
        d.text(col2, y, desc, fReg, 7.6);
        d.text(col3, y, remark, fReg, 7.6);
        y -= 3.6 * MM;
      }
    }

    // ============ RIGHT COLUMN ============
    const rightX0 = MARGIN + COL_W + GUTTER;
    let y2 = PAGE_H - MARGIN - 5 * MM;

    // Attendance record
    {
      const width = COL_W;
      d.centered(rightX0 + width / 2, y2, "ATTENDANCE RECORD", fBold, 9.5);
      let yTop = y2 - 4.4 * MM;

      const labelW = 21 * MM;
      const totalW = 11 * MM;
      const monthW = (width - labelW - totalW) / MONTHS.length;
      const rowH = 8 * MM;
      const headerH = 7 * MM;
      const tableH = headerH + rowH * 3;
      const yBottom = yTop - tableH;

      d.rect(rightX0, yBottom, width, tableH, 0.9);
      d.line(rightX0, yTop - headerH, rightX0 + width, yTop - headerH, 0.6);

      let x = rightX0 + labelW;
      for (let i = 0; i < MONTHS.length; i++) {
        d.line(x, yBottom, x, yTop, 0.6);
        x += monthW;
      }
      d.line(rightX0 + width - totalW, yBottom, rightX0 + width - totalW, yTop, 0.6);

      d.centered(rightX0 + labelW / 2, yTop - 4.6 * MM, "Month", fBold, 7.6);
      let xm = rightX0 + labelW;
      for (const m of MONTHS) {
        d.centered(xm + monthW / 2, yTop - 4.6 * MM, m, fReg, 6.7);
        xm += monthW;
      }
      d.centered(rightX0 + width - totalW / 2, yTop - 4.6 * MM, "Total", fBold, 7.6);

      const rowDefs: [string, "total" | "present" | "absent"][] = [
        ["No. of Class Days", "total"],
        ["No. of Days Present", "present"],
        ["No. of Days Absent", "absent"],
      ];
      let yRow = yTop - headerH;
      let grandTotal = 0, grandPresent = 0;
      for (const [lbl, kind] of rowDefs) {
        const yRowBot = yRow - rowH;
        d.line(rightX0, yRowBot, rightX0 + width, yRowBot, 0.6);
        const lines = lbl.split(" ");
        const mid = Math.ceil(lines.length / 2);
        const line1 = lines.slice(0, mid).join(" ");
        const line2 = lines.slice(mid).join(" ");
        d.centered(rightX0 + labelW / 2, yRow - rowH / 2 + 2.6 * MM, line1, fReg, 6.8);
        d.centered(rightX0 + labelW / 2, yRow - rowH / 2 - 0.6 * MM, line2, fReg, 6.8);

        let xm2 = rightX0 + labelW;
        let rowTotal = 0;
        for (const m of MONTHS) {
          const att = attByMonth[m];
          let val = "";
          if (att) {
            if (kind === "total") val = String(att.total);
            else if (kind === "present") val = String(att.present);
            else val = String(Math.max(att.total - att.present, 0));
          }
          if (val) {
            d.centered(xm2 + monthW / 2, yRowBot + 2.5 * MM, val, fReg, 6.8);
            rowTotal += parseInt(val) || 0;
          }
          xm2 += monthW;
        }
        d.centered(rightX0 + width - totalW / 2, yRowBot + 2.5 * MM, rowTotal ? String(rowTotal) : "", fBold, 7);
        if (kind === "total") grandTotal = rowTotal;
        if (kind === "present") grandPresent = rowTotal;
        yRow = yRowBot;
      }
      y2 = yBottom - 5.5 * MM;
    }

    // Teacher's comments
    {
      const width = COL_W;
      d.centered(rightX0 + width / 2, y2, "TEACHER'S COMMENTS/REMARKS", fBold, 9.5);
      const yTop = y2 - 4.4 * MM;
      const boxH = 14.5 * MM;
      d.rect(rightX0, yTop - boxH * 3, width, boxH * 3, 0.9);
      d.line(rightX0, yTop - boxH, rightX0 + width, yTop - boxH, 0.6);
      d.line(rightX0, yTop - boxH * 2, rightX0 + width, yTop - boxH * 2, 0.6);
      d.text(rightX0 + 2.5 * MM, yTop - 4.6 * MM, "Term 1", fBold, 7.8);
      d.text(rightX0 + 2.5 * MM, yTop - boxH - 4.6 * MM, "Term 2", fBold, 7.8);
      d.text(rightX0 + 2.5 * MM, yTop - boxH * 2 - 4.6 * MM, "Term 3", fBold, 7.8);
      y2 = yTop - boxH * 3 - 6 * MM;
    }

    // Parent signature
    {
      const width = COL_W;
      d.centered(rightX0 + width / 2, y2, "PARENTS/GUARDIAN'S SIGNATURE", fBold, 9.5);
      let y = y2 - 6.2 * MM;
      for (const term of ["Term 1", "Term 2", "Term 3"]) {
        d.text(rightX0 + 11 * MM, y, term, fBold, 8.3);
        d.line(rightX0 + 29 * MM, y - 0.8, rightX0 + width - 2 * MM, y - 0.8);
        y -= 6.8 * MM;
      }
      y2 = y - 2 * MM;
    }

    // Certificate of transfer
    {
      const width = COL_W;
      d.centered(rightX0 + width / 2, y2, "CERTIFICATE OF TRANSFER", fBold, 9.5);
      let y = y2 - 5 * MM;
      const txt = "This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.";
      y = d.wrapped(txt, rightX0, y, width, fReg, 7.8, 3.7 * MM);
      y -= 2 * MM;
      d.text(rightX0, y, "Admitted to Grade:", fReg, 8);
      d.line(rightX0 + 28 * MM, y - 0.8, rightX0 + 60 * MM, y - 0.8);
      y -= 4.6 * MM;
      d.text(rightX0, y, "Eligible for Admission to Grade:", fReg, 8);
      d.line(rightX0 + 43 * MM, y - 0.8, rightX0 + 72 * MM, y - 0.8);
      y -= 4.6 * MM;
      d.text(rightX0, y, "Approved:", fReg, 8);
      y -= 8 * MM;
      d.line(rightX0, y, rightX0 + 33 * MM, y, 0.8);
      d.line(rightX0 + 53 * MM, y, rightX0 + 86 * MM, y, 0.8);
      y -= 3.4 * MM;
      d.centered(rightX0 + 16.5 * MM, y, "School Head", fReg, 7.2);
      d.centered(rightX0 + 69.5 * MM, y, "Adviser", fReg, 7.2);
      y2 = y - 5.2 * MM;
    }

    // Cancellation of eligibility
    {
      const width = COL_W;
      d.centered(rightX0 + width / 2, y2, "CANCELLATION OF ELIGIBILITY TO TRANSFER", fBold, 9.5);
      let y = y2 - 6 * MM;
      d.text(rightX0, y, "Admitted in:", fReg, 8);
      d.line(rightX0 + 18 * MM, y - 0.8, rightX0 + 52 * MM, y - 0.8);
      d.text(rightX0 + 57 * MM, y, "Date:", fReg, 8);
      d.line(rightX0 + 66 * MM, y - 0.8, rightX0 + width, y - 0.8);
      y -= 8 * MM;
      d.line(rightX0, y, rightX0 + 33 * MM, y, 0.8);
      y -= 3.4 * MM;
      d.centered(rightX0 + 16.5 * MM, y, "School Head", fReg, 7.2);
    }

    const pdfBytes = await pdfDoc.save();

    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SF9_${(student.name || "student").replace(/\s+/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function computeAge(birthday: string): number {
  const dob = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}
