// supabase/functions/generate-certificate/index.ts
//
// Generates a "Certificate of Recognition" (academic honors) PDF for a
// single student, matching the official MCPBAHS/DepEd-prescribed layout:
// navy double border, DepEd seal, blackletter "Department of Education",
// Bookman-style body text (Times-Roman standard font as the closest
// built-in equivalent for body text; blackletter is custom-embedded).
//
// Invoke: POST { student_id, period_label, average, honor_title, school_year,
//                day, month }
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
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MM = 2.83465;
const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN = 10 * MM;

const NAVY = rgb(0.12, 0.10, 0.55);
const BLACK = rgb(0, 0, 0);

const SCHOOL_INFO = {
  region: "REGION XI - DAVAO REGION",
  division: "DIVISION OF DAVAO CITY",
  school: "MARIA CRISTINA P. BELCAR AGRICULTURAL HIGH SCHOOL",
  address: "Tawantawan, Baguio District, Davao City",
  principal_name: "Lyndon M. Dumael",
  principal_title: "School Principal II",
};

class Drawer {
  page: PDFPage;
  constructor(page: PDFPage) {
    this.page = page;
  }
  text(x: number, y: number, str: string, font: PDFFont, size: number, color = BLACK) {
    this.page.drawText(str, { x, y, size, font, color });
  }
  centered(cx: number, y: number, str: string, font: PDFFont, size: number, color = BLACK) {
    const w = font.widthOfTextAtSize(str, size);
    this.text(cx - w / 2, y, str, font, size, color);
  }
  line(x1: number, y1: number, x2: number, y2: number, width: number, color = BLACK) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: width, color });
  }
  rect(x: number, y: number, w: number, h: number, width: number, color = BLACK) {
    this.page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: width, opacity: 0 });
  }
  image(img: PDFImage, x: number, y: number, w: number, h: number) {
    this.page.drawImage(img, { x, y, width: w, height: h });
  }
}

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
    const {
      student_id, period_label, average, honor_title,
      school_year, day, month,
    } = body;

    if (!student_id || !period_label || average === undefined) {
      return new Response(JSON.stringify({ error: "student_id, period_label, and average are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: callerProfile } = await callerClient
      .from("profiles").select("role").eq("id", caller.id).single();

    const { data: student, error: studentErr } = await adminClient
      .from("profiles").select("*").eq("id", student_id).eq("role", "student").single();

    if (studentErr || !student) {
      return new Response(JSON.stringify({ error: "Student not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Authorization: admin, or the adviser of this student's section
    let authorized = callerProfile?.role === "admin";
    if (!authorized && callerProfile?.role === "teacher") {
      const { data: section } = await adminClient
        .from("sections").select("adviser_id").eq("id", student.section_id).maybeSingle();
      if (section?.adviser_id === caller.id) authorized = true;
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Forbidden: not authorized for this student" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: section } = await adminClient
      .from("sections").select("*").eq("id", student.section_id).maybeSingle();

    // ---------- Build PDF ----------
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    const fReg = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const fBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

    let fBlack: PDFFont = fBold; // fallback if custom font fetch fails
    try {
      const blackletterBytes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/branding/blackletter.ttf`,
      ).then((r) => r.arrayBuffer());
      fBlack = await pdfDoc.embedFont(blackletterBytes);
    } catch (_e) { /* falls back to Times-Bold */ }

    let depedImg: PDFImage | null = null;
    try {
      const depedBytes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/branding/deped_seal.png`,
      ).then((r) => r.arrayBuffer());
      depedImg = await pdfDoc.embedPng(depedBytes);
    } catch (_e) { /* logo optional */ }

    const d = new Drawer(page);

    // Navy double border
    d.rect(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN, 4, NAVY);
    d.rect(MARGIN + 3.5 * MM, MARGIN + 3.5 * MM, PAGE_W - 2 * MARGIN - 7 * MM, PAGE_H - 2 * MARGIN - 7 * MM, 1.2, NAVY);

    const cx = PAGE_W / 2;
    let y = PAGE_H - MARGIN - 24 * MM;

    const sealR = 12 * MM;
    if (depedImg) d.image(depedImg, cx - sealR, y - sealR, sealR * 2, sealR * 2);
    y -= sealR * 2 + 3 * MM;

    d.centered(cx, y, "Republic of the Philippines", fBold, 12);
    y -= 6.5 * MM;
    d.centered(cx, y, "Department of Education", fBlack, 17);
    y -= 6.5 * MM;
    d.centered(cx, y, SCHOOL_INFO.region, fBold, 9.5);
    y -= 4.3 * MM;
    d.centered(cx, y, SCHOOL_INFO.division, fBold, 9.5);
    y -= 4.6 * MM;
    d.centered(cx, y, SCHOOL_INFO.school, fBold, 10.5);
    y -= 4.6 * MM;
    d.centered(cx, y, SCHOOL_INFO.address, fReg, 8.8);
    y -= 11 * MM;

    d.centered(cx, y, "CERTIFICATE OF RECOGNITION", fBold, 32, NAVY);
    y -= 8 * MM;

    d.centered(cx, y, "This certificate is awarded to", fReg, 12.5);
    y -= 10 * MM;

    const studentName = (student.name || "").toUpperCase();
    d.centered(cx, y, studentName, fBold, 30, NAVY);
    y -= 9 * MM;

    d.centered(cx, y, "in recognition of your meritorious and outstanding academic performance", fReg, 12.5);
    y -= 6.2 * MM;
    d.centered(cx, y, "which made you achieved the", fReg, 12.5);
    y -= 9 * MM;

    d.centered(cx, y, (honor_title || "ACADEMIC EXCELLENCE AWARD").toUpperCase(), fBold, 19, NAVY);
    y -= 9 * MM;

    // "for the TERM ___ of the School Year ____."
    {
      const seg1 = "for the ";
      const seg2 = `${period_label}`;
      const seg3 = " of the School Year ";
      const seg4 = `${school_year || ""}`;
      const seg5 = ".";
      const w1 = fReg.widthOfTextAtSize(seg1, 12);
      const w2 = fBold.widthOfTextAtSize(seg2, 12);
      const w3 = fReg.widthOfTextAtSize(seg3, 12);
      const w4 = fBold.widthOfTextAtSize(seg4, 12);
      const w5 = fReg.widthOfTextAtSize(seg5, 12);
      const totalW = w1 + w2 + w3 + w4 + w5;
      let x = cx - totalW / 2;
      d.text(x, y, seg1, fReg, 12); x += w1;
      d.text(x, y, seg2, fBold, 12); x += w2;
      d.text(x, y, seg3, fReg, 12); x += w3;
      d.text(x, y, seg4, fBold, 12); x += w4;
      d.text(x, y, seg5, fReg, 12);
      y -= 11 * MM;
    }

    // Given this ___ day of ___ ____ at [school], [address].
    {
      const yearForDate = (school_year || "").split("-")[0] || "";
      const line1 = `Given this ${day || "____"} day of ${month || "__________"} ${yearForDate} at ${titleCase(SCHOOL_INFO.school)},`;
      const line2 = "Tawantawan, Davao City, Philippines.";
      d.centered(cx, y, line1, fReg, 10.5);
      y -= 4.8 * MM;
      d.centered(cx, y, line2, fReg, 10.5);
      y -= 13 * MM;
    }

    // Signature
    {
      const sigW = 60 * MM;
      d.line(cx - sigW / 2, y, cx + sigW / 2, y, 0.8);
      y -= 4.6 * MM;
      d.centered(cx, y, SCHOOL_INFO.principal_name.toUpperCase(), fBold, 10.5);
      y -= 4.3 * MM;
      d.centered(cx, y, SCHOOL_INFO.principal_title, fReg, 9.5);
    }

    const pdfBytes = await pdfDoc.save();

    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Certificate_${(student.name || "student").replace(/\s+/g, "_")}_${String(period_label).replace(/\s+/g, "_")}.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
