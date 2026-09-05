// ============================================================
//  App.jsx — FINAL COMPLETE VERSION v27
//  Maria Cristina P. Belcar Agricultural High School
//  School ID: 304342 | S.Y. 2026–2027
//  Dept. of Education · Region XI · Division of Davao City
//
//  What's new in v5:
//  ✅ Grade levels expanded to 7–12
//  ✅ Generic password for all students
//  ✅ Global student lock/unlock
//  ✅ Calendar white screen fixed (hooks moved out of map)
//  ✅ AGRIANS branding on login
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import agriansLogo from "./agrians-logo.png";
import mcpbahsLogo from "./mcpbahs-logo.png";
import dasigAgrianMascot from "./dasig-agrian-mascot-clean.png";
import "./App.css";

const GRADE_LEVELS = [7, 8, 9, 10, 11, 12];

// ⚠️ SY 2026–2027 ONLY. The startDay/endDay values below are this app's
// *local, offline compatibility fallback* for when the canonical
// `agrians_school_days()` RPC (supabase/migrations/20260905_attendance_
// summary_and_term_bounds_fix.sql) is unreachable — see attendanceEngine's
// module comment. The canonical/authoritative calculation used by SF2, SF4,
// SF9, and the primary Student Dashboard path now reads its term boundaries
// from the `school_term_day_bounds` table, which an admin can update every
// school year without a code change. This local array was NOT moved to that
// table (doing so would require every screen below to fetch and merge
// per-year overrides, which is a larger, separate change) — it must be
// updated by hand for SY 2027–2028 and beyond, or the offline fallback path
// will silently miscalculate school days for any month/term outside what's
// listed here. Do not let this list go stale the way agrians_school_days()
// previously did.
const TERM_MONTHS = [
  { month:6,  year:2026, term:1, label:"June 2026",           startDay:8 },
  { month:7,  year:2026, term:1, label:"July 2026" },
  { month:8,  year:2026, term:1, label:"August 2026" },
  { month:9,  year:2026, term:1, label:"Sept 1–15, 2026",     endDay:15 },
  { month:9,  year:2026, term:2, label:"Sept 16–30, 2026",    startDay:16 },
  { month:10, year:2026, term:2, label:"October 2026" },
  { month:11, year:2026, term:2, label:"November 2026" },
  { month:12, year:2026, term:2, label:"December 2026",       endDay:18 },
  { month:1,  year:2027, term:3, label:"January 2027",        startDay:4 },
  { month:2,  year:2027, term:3, label:"February 2027" },
  { month:3,  year:2027, term:3, label:"March 2027" },
  { month:4,  year:2027, term:3, label:"April 2027",          endDay:8 },
];

// The actual school-day dates within one TERM_MONTHS entry: every weekday
// (Mon–Fri) in the entry's day range, minus any date the admin has marked
// as a non-school day (holiday/suspension). This is what drives the SF2
// daily attendance grid — a real calendar, not just a manually-typed count.
const schoolDaysInMonth = (tm, holidays=[]) => {
  const daysInMonth = new Date(tm.year, tm.month, 0).getDate();
  const start = tm.startDay || 1, end = tm.endDay || daysInMonth;
  const out = [];
  for (let d=start; d<=end; d++) {
    const dow = new Date(tm.year, tm.month-1, d).getDay(); // 0=Sun..6=Sat
    if (dow===0||dow===6) continue;
    const iso = `${tm.year}-${String(tm.month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (holidays.some(h=>h.date===iso)) continue;
    out.push({date:iso, day:d, dow});
  }
  return out;
};


// ─────────────────────────────────────────────────────────────
// ONE CALCULATION SOURCE — attendance engine
// Calendar → Daily Attendance → SF2 → SF4 → Learner Dashboard
// Keep attendance math here. Reports and learner-facing summaries should
// consume these normalized values instead of maintaining separate formulas.
// ─────────────────────────────────────────────────────────────
const attendanceEngine = {
  dates: (tm, holidays=[]) => schoolDaysInMonth(tm, holidays),
  configuredDays: (tm, calendar, holidays=[]) => {
    const cal = calendar.find(c=>c.month===tm.month&&c.year===tm.year&&c.term===tm.term);
    // The date grid is the canonical calendar. A configured value is retained
    // for official reporting only when it agrees with the actual school dates.
    const actual = schoolDaysInMonth(tm, holidays).length;
    const configured = cal?.school_days!=null ? Number(cal.school_days) : actual;
    return { actual, configured, agreed: configured===actual, days: schoolDaysInMonth(tm, holidays) };
  },
  studentMonth: (tm, calendar, holidays, rows=[]) => {
    const source = attendanceEngine.configuredDays(tm, calendar, holidays);
    // Only rows belonging to this exact calendar month/term are relevant.
    // Previously, passing the full dailyAttendance array made `encoded` true
    // whenever the learner had attendance in ANY month, which could make an
    // unencoded month appear as 0% or inherit misleading totals.
    const relevantRows = rows.filter(r=>source.days.some(d=>d.date===r.date));
    const statusByDate = new Map(relevantRows.map(r=>[r.date,r.status]));
    const encoded = relevantRows.length>0;
    const present = encoded ? source.days.filter(d=>statusByDate.get(d.date)!=="absent").length : 0;
    // The generated date grid is the canonical denominator. The manually
    // configured calendar count is validated against it, but must never be
    // allowed to produce impossible values such as 21 present / 19 days.
    const totalDays = Math.max(0, source.actual);
    const totalPresent = encoded ? Math.min(Math.max(present,0),totalDays) : 0;
    const absent = encoded ? Math.max(0,totalDays-totalPresent) : 0;
    return { ...source, totalDays, totalPresent, absent,
      pct: encoded && totalDays ? Math.round(totalPresent/totalDays*100) : 0, encoded };
  },
  term: (term, calendar, holidays, rows=[]) => {
    const monthly=TERM_MONTHS.filter(m=>m.term===term).map(m=>{
      const relevant=rows.filter(r=>attendanceEngine.dates(m,holidays).some(d=>d.date===r.date));
      return attendanceEngine.studentMonth(m,calendar,holidays,relevant);
    }).filter(m=>m.encoded).reduce((acc,m)=>({
      totalDays:acc.totalDays+m.totalDays,
      totalPresent:acc.totalPresent+m.totalPresent,
      absent:acc.absent+m.absent
    }),{totalDays:0,totalPresent:0,absent:0});
    return {...monthly,pct:monthly.totalDays?Math.round(monthly.totalPresent/monthly.totalDays*100):0};
  },
  learnerStatus: (average, previousAverage=null) => {
    if (average==null) return {
      key:"welcome", title:"I'm waiting for you, Agrian!", emoji:"🌱",
      quote:"Every great journey starts with one small step. Let's grow together!"
    };
    if (average>=90) return {
      key:"honor", title:"Congratulations, Honor Agrian!", emoji:"🏆",
      quote:"You planted the seeds. You nurtured them. Now celebrate your harvest!"
    };
    if (average>=88) return {
      key:"almost", title:"Almost There, Agrian!", emoji:"🌟",
      quote:"You're so close! Keep your focus, stay consistent, and Dasig, Agrian!"
    };
    if (previousAverage!=null && average>previousAverage) return {
      key:"rising", title:"You're Growing!", emoji:"🌱",
      quote:"Look at that progress! Small improvements grow into big achievements."
    };
    return {
      key:"encourage", title:"Keep Going, Agrian!", emoji:"💚",
      quote:"Don't compare your chapter to someone else's. Keep planting good seeds!"
    };
  }
};

// Design tokens — harmonized with src/index.css / src/App.css (green & slate
// design system, palette named after Mint/Sage/Fern/Emerald/Jade/Forest).
// Kept as plain hex (not var(--...)) on purpose: several call sites append
// an alpha suffix directly to these strings (e.g. T.green3+"22"), which only
// works with literal hex colors, not CSS custom properties.
const T = {
  bg:"#f8fafc", bgCard:"#ffffff", bgPanel:"#EEF6EC",
  green1:"#1F4638", green2:"#2F6B4C", green3:"#3E8A63",
  green4:"#5CA37D", greenLight:"#8FC49A",
  yellow:"#f59e0b", yellowDark:"#d97706",
  blue:"#2563eb", red:"#ef4444",
  white:"#ffffff", gray:"#94a3b8",
  border:"#cbd5e150", text:"#0f172a", textMuted:"#475569",
};

const css = `
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:var(--font-sans);background:var(--bg-root);color:var(--text-secondary);}
  ::-webkit-scrollbar{width:6px;height:6px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:999px;}
  input,select,textarea{
    font-family:var(--font-sans);
    background:var(--bg-surface);color:var(--text-primary);border:1.5px solid var(--border-default);
    border-radius:var(--radius-md);padding:10px 14px;width:100%;outline:none;font-size:14px;
    transition:border-color .15s ease,box-shadow .15s ease;
  }
  input:hover,select:hover,textarea:hover{border-color:var(--border-strong);}
  input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow);}
  input::placeholder,textarea::placeholder{color:var(--text-muted);}
  button{cursor:pointer;border:none;border-radius:var(--radius-md);font-weight:600;
    font-family:var(--font-sans);transition:all .2s var(--ease-in-out);}
  @keyframes spin{to{transform:rotate(360deg)}}

.agrians-login{min-height:100vh;position:relative;overflow:hidden;display:flex;flex-direction:column;
  background:radial-gradient(circle at 78% 18%,#3e8a6340 0,transparent 30%),
             radial-gradient(circle at 18% 82%,#f5c84226 0,transparent 27%),
             linear-gradient(135deg,#071b14 0%,#102f23 42%,#173d2d 72%,#0a2018 100%);
  color:#fff;font-family:var(--font-sans);}
.login-grid{position:absolute;inset:0;opacity:.08;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
  background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 90%);pointer-events:none;}
.login-orb{position:absolute;border-radius:50%;filter:blur(1px);pointer-events:none;}
.login-orb-a{width:420px;height:420px;right:-150px;top:-150px;background:#5ca37d26;box-shadow:0 0 100px #5ca37d20;animation:loginPulse 7s ease-in-out infinite;}
.login-orb-b{width:300px;height:300px;left:-130px;bottom:-130px;background:#f5c84216;box-shadow:0 0 90px #f5c84218;animation:loginPulse 9s ease-in-out infinite reverse;}
.login-header{position:relative;z-index:2;display:flex;align-items:center;gap:13px;padding:22px clamp(20px,5vw,70px);
  border-bottom:1px solid #ffffff14;background:#071b14aa;backdrop-filter:blur(16px);}
.login-school-mark{width:54px;height:54px;border-radius:16px;padding:3px;background:linear-gradient(145deg,#f5c842,#8fc49a);
  box-shadow:0 8px 24px #00000035;overflow:hidden;flex-shrink:0;}
.login-school-mark img{width:100%;height:100%;object-fit:cover;border-radius:13px;}
.login-dep{font-size:9px;letter-spacing:1.1px;color:#b7d5bf;font-weight:700;margin-bottom:3px;}
.login-school-name{font-size:clamp(13px,1.7vw,18px);font-weight:900;letter-spacing:-.2px;}
.login-school-sub{font-size:10px;color:#8fb39d;margin-top:3px;}
.login-main{position:relative;z-index:2;width:min(1120px,calc(100% - 32px));margin:auto;display:grid;grid-template-columns:1fr minmax(360px,470px);
  gap:clamp(34px,7vw,90px);align-items:center;padding:42px 0;}
.login-brand-panel{padding:20px 10px;text-align:left;}
.login-brand-logo-wrap{position:relative;width:146px;height:146px;margin-bottom:22px;display:grid;place-items:center;animation:loginFloat 5s ease-in-out infinite;}
.login-ring{position:absolute;inset:-13px;border:1px solid #f5c84275;border-radius:50%;box-shadow:0 0 0 10px #f5c84208,0 0 50px #5ca37d22;}
.login-ring:after{content:"";position:absolute;width:8px;height:8px;border-radius:50%;background:#f5c842;top:15px;right:17px;box-shadow:0 0 18px #f5c842;}
.login-brand-logo{width:146px;height:146px;object-fit:cover;border-radius:50%;border:4px solid #f5c842;box-shadow:0 18px 55px #00000055;}
.login-project{font-size:clamp(34px,5vw,58px);font-weight:950;letter-spacing:-2px;line-height:1;}
.login-project span{color:#f5c842;}
.login-fullname{max-width:560px;color:#c5dccd;font-size:13px;line-height:1.7;margin-top:12px;}
.login-tagline{font-size:15px;color:#fff;font-weight:800;font-style:italic;margin-top:13px;}
.login-seed-line{display:flex;align-items:center;gap:9px;margin-top:20px;color:#f5c842;font-size:17px;}
.login-seed-line i{height:1px;width:38px;background:linear-gradient(90deg,#f5c842,#5ca37d);opacity:.7;}
.login-purpose{max-width:520px;color:#8fb39d;font-size:11px;line-height:1.7;margin-top:17px;}
.login-card{position:relative;background:#fffffffa;color:#0f172a;border:1px solid #ffffff55;border-radius:26px;padding:27px;
  box-shadow:0 28px 80px #00000055,0 4px 18px #00000020;backdrop-filter:blur(20px);overflow:hidden;}
.login-card:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#1f4638,#5ca37d,#f5c842,#5ca37d,#1f4638);}
.login-card:after{content:"";position:absolute;top:0;left:-50%;width:35%;height:4px;background:#fff8;filter:blur(3px);animation:loginShimmer 5s linear infinite;}
.login-card-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:20px;}
.login-eyebrow{font-size:9px;font-weight:900;letter-spacing:1.4px;color:#3e8a63;margin-bottom:5px;}
.login-card h1{font-size:27px;letter-spacing:-.7px;line-height:1.1;}
.login-card-top p{font-size:11px;color:#64748b;margin-top:5px;}
.login-lock{width:43px;height:43px;border-radius:14px;background:#eef6ec;display:grid;place-items:center;font-size:20px;}
.login-role-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:5px;background:#eef6ec;border-radius:14px;margin-bottom:11px;}
.login-role{padding:10px 5px;border-radius:10px;background:transparent;color:#64748b;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;}
.login-role-icon{font-size:17px;line-height:1;}
.login-role.active{background:#1f4638;color:#fff;box-shadow:0 6px 16px #1f46383d;transform:translateY(-1px);}
.login-selected{display:flex;align-items:center;gap:9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:11px;padding:9px 11px;margin-bottom:15px;}
.login-selected>span{font-size:19px}.login-selected b{display:block;font-size:11px}.login-selected small{display:block;color:#64748b;font-size:9px;margin-top:2px;}
.login-label{display:block;font-size:10px;font-weight:800;color:#475569;margin:11px 0 5px;letter-spacing:.2px;}
.login-input-wrap{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1.5px solid #dbe4e8;border-radius:11px;padding:0 11px;transition:.2s;}
.login-input-wrap:focus-within{border-color:#3e8a63;box-shadow:0 0 0 4px #3e8a6315;background:#fff;}
.login-input-wrap>span{font-size:14px}.login-input-wrap input{border:0!important;box-shadow:none!important;background:transparent!important;padding:11px 3px!important;font-size:12px;}
.login-error{display:flex;gap:7px;align-items:flex-start;background:#fff1f2;border:1px solid #fecdd3;color:#be123c;border-radius:10px;padding:9px 10px;font-size:10.5px;margin-top:12px;line-height:1.45;}
.login-submit{position:relative;overflow:hidden;width:100%;margin-top:14px;padding:13px 15px;border-radius:12px;color:#fff;
  background:linear-gradient(135deg,#1f4638,#3e8a63);box-shadow:0 10px 22px #1f46383b;display:flex;justify-content:space-between;align-items:center;font-size:12px;}
.login-submit:before{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,#ffffff22 50%,transparent 65%);transform:translateX(-120%);}
.login-submit:hover:before{animation:loginShimmer .9s ease;}
.login-submit:hover{transform:translateY(-1px);box-shadow:0 13px 28px #1f463846;}
.login-submit:disabled{opacity:.7;cursor:wait;transform:none;}
.login-submit b{font-size:18px;line-height:1;}
.login-security{display:flex;align-items:center;justify-content:center;gap:5px;color:#94a3b8;font-size:8.5px;margin-top:13px;text-align:center;}
.login-security span{color:#3e8a63;font-size:8px;}
.login-footer{position:relative;z-index:2;display:flex;justify-content:center;gap:9px;flex-wrap:wrap;padding:16px 20px 22px;color:#759783;font-size:9px;letter-spacing:.2px;}
@media(max-width:800px){
  .login-header{padding:16px 18px}.login-main{grid-template-columns:1fr;gap:12px;padding:28px 0;}
  .login-brand-panel{text-align:center;padding:5px 8px}.login-brand-logo-wrap{margin:0 auto 18px;width:105px;height:105px}.login-brand-logo{width:105px;height:105px;}
  .login-project{font-size:38px}.login-fullname,.login-purpose{margin-left:auto;margin-right:auto}.login-seed-line{justify-content:center;}
  .login-card{width:min(470px,100%);margin:0 auto;padding:22px;}
}
@media(max-width:430px){.login-dep{font-size:7.5px}.login-school-name{font-size:12px}.login-school-mark{width:46px;height:46px}.login-card{border-radius:20px}.login-project{font-size:32px;}}
`;

const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;


// ── STUDENT NAME DISPLAY ─────────────────────────────────────────────────
// Keep the learner's encoded/DepEd-style order throughout the application,
// e.g. "DELA CRUZ, JUAN, D.". Teachers are accustomed to this sequence and
// the same order should appear while encoding, reviewing, monitoring, and in
// learner records. SF2/SF9 also retain this exact stored order.
const displayStudentName = raw => String(raw||'').trim().replace(/\s+/g,' ');
const studentDisplay = student => displayStudentName(student?.name);
const studentNameText = value => displayStudentName(value);

// Consistent learner ordering for grade encoding/review: Male first, then Female,
// then any unspecified/other value. Within each group, learners are alphabetized
// by their encoded surname-first display name so the roster matches teacher records.
const sortStudentsMaleFirst = list => [...(list||[])].sort((a,b)=>{
  const rank=v => v === "Male" ? 0 : v === "Female" ? 1 : 2;
  const genderDiff=rank(a?.gender)-rank(b?.gender);
  if (genderDiff!==0) return genderDiff;
  return studentDisplay(a).localeCompare(studentDisplay(b),undefined,{sensitivity:"base"});
});

// ── MAPEH components ────────────────────────────────────────────────────
// MAPEH is not graded directly. It has two components — "PE and Health"
// and "Music and Arts" — each its own subject row (own teacher, own grades)
// linked back to the "MAPEH" subject via parent_subject_id. Everywhere the
// app needs "the grade for a subject", it should go through gradeForTerm
// below so MAPEH transparently resolves to the average of its components.
const mapehComponentsOf = (subject, allSubjects) =>
  allSubjects.filter(s => s.parent_subject_id === subject.id);
const isMapehParent = (subject, allSubjects) =>
  allSubjects.some(s => s.parent_subject_id === subject.id);

// Grade for one subject for one term. Works for both regular subjects
// (looked up directly in `gradesArr`) and MAPEH-style parent subjects
// (averaged from whichever of its components have a grade that term).
const gradeForTerm = (subject, term, allSubjects, gradesArr) => {
  if (!subject) return null;
  const comps = mapehComponentsOf(subject, allSubjects);
  if (comps.length > 0) {
    const vals = comps
      .map(c => gradesArr.find(g => g.subject_id === c.id && g.term === term)?.grade)
      .filter(v => v !== undefined && v !== null);
    // MAPEH is displayed as a whole-number average of its components (DepEd
    // convention) — must match the rounding used in generate-sf9/index.ts so
    // the Student Dashboard, Teacher Review, Admin Statistics and the
    // official SF9 PDF never disagree on the same learner's MAPEH grade.
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : null;
  }
  return gradesArr.find(g => g.subject_id === subject.id && g.term === term)?.grade ?? null;
};
const remark = g => {
  if (!g) return { r:"N/A", c:T.gray };
  if (g>=90) return { r:"Outstanding", c:"#2e7d32" };
  if (g>=85) return { r:"Very Satisfactory", c:"#388e3c" };
  if (g>=80) return { r:"Satisfactory", c:"#e6a800" };
  if (g>=75) return { r:"Fairly Satisfactory", c:"#ff9800" };
  return { r:"Did Not Meet Expectations", c:T.red };
};
const attendColor = pct => pct>=90?"#2e7d32":pct>=75?T.yellow:T.red;

// Computes grade-encoding completion for one section: for every subject that
// applies to that section (matching grade level, and TVE qualification when
// the subject is TVE-tagged), how many of the expected student×term grade
// entries actually exist. Used by the Admin overview and the Adviser panel.
const computeSectionEncoding = (section, subjects, students, grades) => {
  const secStudents = students.filter(s => s.section_id === section.id);
  const applicable = subjects.filter(sub => sub.grade_level === section.grade_level
    && (!sub.section_id || sub.section_id === section.id)
    // MAPEH itself is never graded directly (its grade is derived from its
    // components), so it has no rows in `grades` and shouldn't be tracked
    // as its own pending line item — its components already are.
    && !isMapehParent(sub, subjects));
  let totalExpected = 0, totalActual = 0;
  const subjectStats = applicable.map(sub => {
    const eligible = sub.tve_qualification
      ? secStudents.filter(s => s.tve_qualification === sub.tve_qualification)
      : secStudents;
    const expected = eligible.length * 3; // 3 terms
    const eligibleIds = new Set(eligible.map(s => s.id));
    const actual = grades.filter(g => g.subject_id === sub.id && eligibleIds.has(g.student_id)).length;
    totalExpected += expected; totalActual += actual;
    return { subject: sub, eligibleCount: eligible.length, expected, actual,
      percent: expected>0 ? Math.round((actual/expected)*100) : null };
  }).filter(s => s.expected > 0); // subjects with nobody eligible aren't meaningful here
  return {
    section, studentCount: secStudents.length,
    percent: totalExpected>0 ? Math.round((totalActual/totalExpected)*100) : null,
    totalExpected, totalActual,
    doneSubjects: subjectStats.filter(s => s.percent===100),
    pendingSubjects: subjectStats.filter(s => s.percent!==100),
  };
};

const encodingColor = pct => pct===null?T.gray:pct>=100?T.green4:pct>=50?T.yellow:T.red;

const EncodingProgressCard = ({ result }) => {
  const { section, percent, doneSubjects, pendingSubjects, studentCount } = result;
  return (
    <Card style={{marginBottom:8,padding:"10px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:T.text}}>{section.name}</div>
          <div style={{fontSize:11,color:T.textMuted}}>{studentCount} students</div>
        </div>
        <div style={{fontSize:20,fontWeight:900,color:encodingColor(percent)}}>
          {percent===null?"—":`${percent}%`}
        </div>
      </div>
      <div style={{height:8,borderRadius:6,background:"#E3EEDD",overflow:"hidden",marginBottom:8}}>
        <div style={{height:"100%",width:`${percent||0}%`,background:encodingColor(percent),transition:"width .3s"}}/>
      </div>
      {doneSubjects.length===0&&pendingSubjects.length===0
        ?<div style={{fontSize:11,color:T.gray}}>No subjects apply to this section yet.</div>
        :(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {doneSubjects.map(s=>(
              <span key={s.subject.id} style={{fontSize:10,fontWeight:700,color:"#2e7d32",
                background:"#EEF6EC",border:"1px solid #C9E0BE",borderRadius:10,padding:"2px 8px"}}>
                ✅ {s.subject.name}
              </span>
            ))}
            {pendingSubjects.map(s=>(
              <span key={s.subject.id} style={{fontSize:10,fontWeight:700,color:T.red,
                background:"#ffebee",border:"1px solid #f0c0c0",borderRadius:10,padding:"2px 8px"}}>
                ⏳ {s.subject.name} ({s.actual}/{s.expected})
              </span>
            ))}
          </div>
        )
      }
    </Card>
  );
};

const edgeCall = async (fn, body) => {
  try {
    const { data:{ session } } = await supabase.auth.getSession();
    if (!session) return { error: "Your session has expired. Please log in again." };
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`,
      { method:"POST",
        // Supabase's gateway expects BOTH apikey and Authorization on direct
        // fetch() calls to /functions/v1/* — supabase.functions.invoke() adds
        // apikey automatically, but a raw fetch (needed here to stream back
        // binary/blob responses) has to set it explicitly or the gateway can
        // reject the request before it even reaches the function code.
        headers:{"Content-Type":"application/json","apikey":import.meta.env.VITE_SUPABASE_ANON_KEY,"Authorization":`Bearer ${session.access_token}`},
        body:JSON.stringify(body) }
    );
    let json;
    try { json = await res.json(); }
    catch { return { error: `Server returned an invalid response (status ${res.status}).` }; }
    if (!res.ok && !json.error) return { error: json.message || `Request failed (status ${res.status}).` };
    return json;
  } catch (err) {
    return { error: err.message || "Network error — please check your connection and try again." };
  }
};

const Card = ({ children, style={}, className="" }) => (
  <div className={`card animate-fade-in-scale ${className}`.trim()} style={{background:T.bgCard,borderRadius:"var(--radius-lg)",padding:16,
    border:"1px solid var(--border-subtle)",boxShadow:"var(--shadow-sm)",...style}}>
    {children}
  </div>
);
const Btn = ({ children, onClick, color=T.green3, style={}, disabled=false }) => (
  <button className="btn" onClick={onClick} disabled={disabled} style={{
    background:disabled?"#cbd5e1":color,color:color===T.yellow?T.text:T.white,
    padding:"10px 16px",fontSize:13,borderRadius:"var(--radius-md)",
    boxShadow:disabled?"none":"var(--shadow-sm)",
    ...style,opacity:disabled?.6:1}}>{children}</button>
);
const Badge = ({ text, color }) => (
  <span className="badge" style={{background:color+"1a",color,border:`1px solid ${color}55`,
    borderRadius:"var(--radius-full)",padding:"2px 10px",fontSize:11,fontWeight:700}}>{text}</span>
);

/* ─────────────────────────────────────────────────────────
   AGRIANS 2.0 visual layer
   Lightweight, dependency-free data visualizations and welcome
   surfaces. These sit above the existing business logic so the
   existing DepEd form generators remain untouched.
   ───────────────────────────────────────────────────────── */
const WelcomePanel = ({ profile, role="User", stats=[] }) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const roleCopy = {
    student:"Your learning journey at MCPBAHS starts here.",
    teacher:"Your teaching workspace is ready.",
    admin:"Your school operations command center is ready.",
  }[role] || "Welcome to AGRIANS.";
  return (
    <section className="welcome-panel">
      <div className="welcome-orb welcome-orb-a"/>
      <div className="welcome-orb welcome-orb-b"/>
      <div className="welcome-content">
        <div className="welcome-eyebrow"><span className="welcome-dot"/> AGRIANS · S.Y. 2026–2027</div>
        <h1>{greeting}, {profile?.name?.split(" ")[0] || "there"}.</h1>
        <p>{roleCopy}</p>
        <div className="welcome-stats">
          {stats.filter(Boolean).slice(0,3).map((s,i)=>(
            <div className="welcome-stat" key={i}>
              <span className="welcome-stat-icon">{s.icon}</span>
              <div><strong>{s.value}</strong><small>{s.label}</small></div>
            </div>
          ))}
        </div>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="leaf leaf-1">⌁</div><div className="leaf leaf-2">⌁</div>
        <div className="welcome-ring"><span>🌱</span></div>
      </div>
    </section>
  );
};

const ProgressRing = ({ value=0, label="Progress", size=112 }) => {
  const safe=Math.max(0,Math.min(100,Number(value)||0));
  return (
    <div className="progress-ring" style={{width:size,height:size,background:`conic-gradient(var(--accent) ${safe*3.6}deg, var(--border-subtle) 0)`}}>
      <div className="progress-ring-inner">
        <strong>{Math.round(safe)}%</strong><span>{label}</span>
      </div>
    </div>
  );
};

const MiniBarChart = ({ data=[], max, height=150, label="Count" }) => {
  const highest=max||Math.max(1,...data.map(d=>Number(d.value)||0));
  return (
    <div className="mini-chart" style={{height}}>
      <div className="mini-chart-bars">
        {data.map((d,i)=>{
          const v=Number(d.value)||0;
          return (
            <div className="mini-bar-item" key={i} title={`${d.label}: ${v}`}>
              <div className="mini-bar-track"><div className="mini-bar-fill" style={{height:`${Math.max(v?7:0,(v/highest)*100)}%`}}/></div>
              <strong>{v}</strong><span>{d.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mini-chart-caption">{label}</div>
    </div>
  );
};

const TrendChart = ({ values=[], labels=[], height=150 }) => {
  const nums=values.map(v=>Number(v)||0);
  const max=Math.max(1,...nums), min=Math.min(0,...nums);
  const w=520, h=height, pad=18;
  const points=nums.map((v,i)=>{
    const x=pad+(nums.length<=1?0:i*(w-pad*2)/(nums.length-1));
    const y=h-pad-((v-min)/(max-min||1))*(h-pad*2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="trend-chart" style={{height}}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="Performance trend">
        <defs><linearGradient id="agriansTrendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopOpacity=".25"/><stop offset="100%" stopOpacity="0"/>
        </linearGradient></defs>
        <polyline className="trend-area" points={`${pad},${h-pad} ${points} ${w-pad},${h-pad}`}/>
        <polyline className="trend-line" points={points}/>
        {nums.map((v,i)=>{
          const [x,y]=points.split(" ")[i].split(",");
          return <circle className="trend-dot" key={i} cx={x} cy={y} r="4"/>;
        })}
      </svg>
      <div className="trend-labels">{labels.map((l,i)=><span key={i}>{l}</span>)}</div>
    </div>
  );
};

const SectionHeading = ({eyebrow,title,action}) => (
  <div className="section-heading">
    <div><div className="section-eyebrow">{eyebrow}</div><h2>{title}</h2></div>
    {action}
  </div>
);

const Toast = ({ msg }) => msg?(
  <div className="animate-slide-in-up" style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",
    background:msg.startsWith("✅")?T.green2:msg.startsWith("🗑️")?"#5d4037":
    msg.startsWith("⏳")?T.blue:"#dc2626",
    color:"#fff",padding:"10px 20px",borderRadius:"var(--radius-full)",fontSize:13,fontWeight:700,
    zIndex:999,boxShadow:"var(--shadow-xl)",whiteSpace:"nowrap"}}>{msg}</div>
):null;
const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
    height:"100vh",background:T.bg,flexDirection:"column",gap:16}}>
    <div style={{width:48,height:48,border:"4px solid var(--border-subtle)",
      borderTop:`4px solid ${T.green3}`,borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    <div style={{color:T.textMuted,fontSize:14,fontWeight:600}}>Loading...</div>
  </div>
);

const SchoolHeader = ({ small=false }) => (
  <div style={{padding:small?"10px 12px":"20px 16px",
    background:"linear-gradient(160deg,#101F19 0%,#1F4638 30%,#2F6B4C 65%,#17332A 100%)",
    borderBottom:`4px solid ${T.yellow}`,boxShadow:"var(--shadow-lg)",
    position:"relative",overflow:"hidden"}}>
    <div style={{position:"absolute",inset:0,opacity:0.04,
      backgroundImage:"radial-gradient(circle,#ffffff 1px,transparent 1px)",
      backgroundSize:"20px 20px",pointerEvents:"none"}}/>
    <div style={{position:"absolute",top:0,left:0,right:0,height:4,
      background:"linear-gradient(90deg,#003082 33%,#ce1126 33%,#ce1126 66%,#f5c800 66%)"}}/>
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      gap:12,position:"relative",zIndex:1,marginTop:small?2:6}}>
      <div style={{width:small?44:64,height:small?44:64,borderRadius:"50%",
        border:`3px solid ${T.yellow}`,boxShadow:"0 2px 12px #0006",flexShrink:0,
        overflow:"hidden",background:"linear-gradient(160deg,#1F4638,#2F6B4C)",
        display:"flex",alignItems:"center",justifyContent:"center"}}>
        <img src={mcpbahsLogo} alt="MCPBAHS Logo"
          style={{width:"100%",height:"100%",objectFit:"cover"}}/>
      </div>
      <div style={{textAlign:"left"}}>
        <div style={{fontSize:small?9:11,color:"#A9CB9C",fontWeight:600,letterSpacing:.5,lineHeight:1.5}}>
          Department of Education · Region XI · Division of Davao City
        </div>
        <div style={{fontSize:small?13:17,fontWeight:900,color:"#ffffff",lineHeight:1.2,textShadow:"0 1px 4px #0006"}}>
          Maria Cristina P. Belcar
        </div>
        <div style={{fontSize:small?13:17,fontWeight:900,color:T.yellow,lineHeight:1.2,textShadow:"0 1px 4px #0006"}}>
          Agricultural High School
        </div>
        <div style={{fontSize:small?9:11,color:"#A9CB9C",marginTop:3,display:"flex",gap:8,alignItems:"center"}}>
          <span>School ID: 304342</span>
          <span style={{color:T.yellow}}>·</span>
          <span>S.Y. 2026–2027</span>
        </div>
      </div>
    </div>
    <div style={{position:"absolute",bottom:0,left:0,right:0,height:small?3:5,
      background:"linear-gradient(90deg,#1F4638,#5CA37D,#f5c800,#5CA37D,#1F4638)",opacity:0.7}}/>
  </div>
);

const AgriansBranding = () => (
  <div className="dialog-sm" style={{display:"flex",flexDirection:"column",alignItems:"center",
    justifyContent:"center",textAlign:"center",padding:"20px 20px 0px 20px"}}>
    <div style={{width:110,height:110,borderRadius:"50%",overflow:"hidden",marginBottom:12,
      boxShadow:"0 4px 20px #00000025",border:`3px solid ${T.yellow}`,
      display:"flex",alignItems:"center",justifyContent:"center"}}>
      <img src={agriansLogo} alt="AGRIANS Logo"
        style={{width:"100%",height:"100%",objectFit:"cover",
          mixBlendMode:"multiply",filter:"contrast(1.1) saturate(1.2)"}}/>
    </div>
    <div style={{fontSize:22,fontWeight:900,color:T.green1,letterSpacing:1,marginBottom:2}}>
      Project <span style={{color:T.green3}}>AGRIANS</span>
    </div>
    <div style={{fontSize:13,fontWeight:600,color:T.textMuted,marginBottom:8,fontStyle:"italic"}}>
      No paper. No waiting. Just progress.
    </div>
    <div style={{display:"flex",height:3,borderRadius:4,overflow:"hidden",width:180,marginBottom:8}}>
      <div style={{flex:1,background:T.blue}}/><div style={{flex:1,background:T.red}}/>
      <div style={{flex:1,background:T.yellow}}/>
    </div>
    <div style={{fontSize:10,color:T.gray,lineHeight:1.9,letterSpacing:.5,marginBottom:4}}>
      <span style={{fontWeight:700,color:T.green3}}>A</span>cademic{" "}
      <span style={{fontWeight:700,color:T.green3}}>G</span>rade{" "}
      <span style={{fontWeight:700,color:T.green3}}>R</span>elease {"&"}{" "}
      <span style={{fontWeight:700,color:T.green3}}>I</span>nteractive{" "}
      <span style={{fontWeight:700,color:T.green3}}>A</span>ppointment{" "}
      <span style={{fontWeight:700,color:T.green3}}>N</span>etwork{" "}
      <span style={{fontWeight:700,color:T.green3}}>S</span>ystem
    </div>
  </div>
);

const TopBar = ({ name, sub, onLogout }) => (
  <div style={{background:T.bgCard,padding:"10px 16px",display:"flex",
    justifyContent:"space-between",alignItems:"center",
    borderBottom:"1px solid var(--border-subtle)",boxShadow:"var(--shadow-sm)"}}>
    <div>
      <div style={{fontWeight:700,fontSize:14,color:T.green1}}>{name}</div>
      <div style={{fontSize:11,color:T.textMuted}}>{sub}</div>
    </div>
    <Btn onClick={onLogout} color={T.red} style={{padding:"6px 12px",fontSize:12}}>Logout</Btn>
  </div>
);

const BottomNav = ({ tabs, active, setActive }) => (
  <div style={{position:"fixed",bottom:0,left:0,right:0,background:T.bgCard,
    borderTop:"1px solid var(--border-subtle)",display:"flex",zIndex:100,boxShadow:"0 -4px 16px rgba(15,23,42,0.06)",
    backdropFilter:"blur(12px)"}}>
    {tabs.map(([ic,lb,tb])=>(
      <button key={tb} className="btn-ghost" onClick={()=>setActive(tb)} style={{
        flex:1,padding:"10px 2px",background:"transparent",border:"none",cursor:"pointer",
        borderRadius:0,color:active===tb?T.green2:T.gray,display:"flex",flexDirection:"column",
        alignItems:"center",fontSize:9,fontWeight:active===tb?700:400,gap:2,
        transition:"color .2s var(--ease-in-out), border-color .2s var(--ease-in-out)",
        borderTop:active===tb?`2px solid ${T.green3}`:"2px solid transparent"}}>
        <span style={{fontSize:18,transition:"transform .2s var(--ease-out-back)",
          transform:active===tb?"scale(1.1)":"scale(1)"}}>{ic}</span>{lb}
      </button>
    ))}
  </div>
);

const ResetPasswordModal = ({ user, onConfirm, onClose }) => {
  const [newPass,setNewPass]=useState("");
  const [showPass,setShowPass]=useState(false);
  const strength=newPass.length===0?0:newPass.length<6?1:newPass.length<9?2:newPass.length<12?3:4;
  const sLabel=["","Too short","Weak","Good","Strong"][strength];
  const sColor=[T.gray,T.red,"#ff9800",T.yellow,T.green4][strength];
  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:300,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card className="dialog-sm">
        <div style={{fontSize:16,fontWeight:800,color:T.green1,marginBottom:4}}>🔑 Reset Password</div>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:16}}>
          For: <strong style={{color:T.green1}}>{user.name}</strong>&nbsp;
          <span style={{background:T.green4+"22",color:T.green2,borderRadius:20,
            padding:"1px 8px",fontSize:11,fontWeight:700}}>{user.role}</span>
        </div>
        <div style={{position:"relative",marginBottom:8}}>
          <input type={showPass?"text":"password"} value={newPass}
            onChange={e=>setNewPass(e.target.value)} placeholder="Minimum 6 characters"
            onKeyDown={e=>e.key==="Enter"&&onConfirm(newPass)} style={{paddingRight:44}}/>
          <button onClick={()=>setShowPass(p=>!p)} style={{position:"absolute",right:10,
            top:"50%",transform:"translateY(-50%)",background:"none",border:"none",
            cursor:"pointer",fontSize:16,color:T.textMuted}}>{showPass?"🙈":"👁️"}</button>
        </div>
        {newPass.length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
            {[1,2,3,4].map(i=>(
              <div key={i} style={{flex:1,height:4,borderRadius:2,
                background:strength>=i?sColor:"#e0e0e0",transition:"background .2s"}}/>
            ))}
            <span style={{fontSize:11,color:sColor,flexShrink:0}}>{sLabel}</span>
          </div>
        )}
        {newPass.length===0&&<div style={{marginBottom:14}}/>}
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={()=>onConfirm(newPass)} disabled={newPass.length<6} style={{flex:1}}>🔑 Reset</Btn>
          <Btn onClick={onClose} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
};

const ChangePasswordCard = ({ notify }) => {
  const [currentPass,setCurrentPass]=useState("");
  const [newPass,setNewPass]=useState("");
  const [confirmPass,setConfirmPass]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [saving,setSaving]=useState(false);
  const strength=newPass.length===0?0:newPass.length<6?1:newPass.length<9?2:newPass.length<12?3:4;
  const sLabel=["","Too short","Weak","Good","Strong"][strength];
  const sColor=[T.gray,T.red,"#ff9800",T.yellow,T.green4][strength];

  const submit=async()=>{
    if (newPass.length<6){notify("❌ New password must be at least 6 characters.");return;}
    if (newPass!==confirmPass){notify("❌ New password and confirmation don't match.");return;}
    setSaving(true);
    // Re-authenticate with current password first, to confirm identity before changing it
    const {data:{user}}=await supabase.auth.getUser();
    if (!user?.email){notify("❌ Could not verify your account.");setSaving(false);return;}
    const {error:verifyErr}=await supabase.auth.signInWithPassword({
      email:user.email,password:currentPass,
    });
    if (verifyErr){
      notify("❌ Current password is incorrect.");
      setSaving(false);
      return;
    }
    const {error}=await supabase.auth.updateUser({password:newPass});
    setSaving(false);
    if (error){notify("❌ "+error.message);return;}
    notify("✅ Password changed successfully!");
    setCurrentPass("");setNewPass("");setConfirmPass("");
  };

  return (
    <Card>
      <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>🔒 Change Password</div>
      <div style={{display:"grid",gap:8,marginBottom:8}}>
        <input type={showPass?"text":"password"} placeholder="Current Password"
          value={currentPass} onChange={e=>setCurrentPass(e.target.value)}/>
        <input type={showPass?"text":"password"} placeholder="New Password (min 6 characters)"
          value={newPass} onChange={e=>setNewPass(e.target.value)}/>
        {newPass.length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {[1,2,3,4].map(i=>(
              <div key={i} style={{flex:1,height:4,borderRadius:2,
                background:strength>=i?sColor:"#e0e0e0",transition:"background .2s"}}/>
            ))}
            <span style={{fontSize:11,color:sColor,flexShrink:0}}>{sLabel}</span>
          </div>
        )}
        <input type={showPass?"text":"password"} placeholder="Confirm New Password"
          value={confirmPass} onChange={e=>setConfirmPass(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}/>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:T.textMuted}}>
          <input type="checkbox" checked={showPass} onChange={e=>setShowPass(e.target.checked)}/>
          Show passwords
        </label>
      </div>
      <Btn onClick={submit} disabled={saving||!currentPass||newPass.length<6} style={{width:"100%"}}>
        {saving?"⏳ Saving...":"🔒 Update Password"}
      </Btn>
    </Card>
  );
};
// TVE qualifications are now admin-managed (table `tve_qualifications`) instead
// of hardcoded, so admin can rename/add/remove them — see AdminDashboard Settings tab.
// This fallback list is only used if that table hasn't loaded yet / is empty.
const TVE_QUALIFICATIONS_FALLBACK = ["AgriCrop Production", "Animal Production", "Food Processing", "MSES"];
const GRADE11_TRACKS = ["Academic", "TechPro"];
const GRADE11_TECHPRO_SUBCHOICES = ["Bakery Operations", "Organic Agriculture Production"];
const GRADE12_TRACKS = ["TVL-AFA", "TVL-HE"];

const AddStudentForm = ({ sections, gradeFilter, onAdd, loading, qualifications }) => {
  const tveOptions=(qualifications&&qualifications.length>0)?qualifications:TVE_QUALIFICATIONS_FALLBACK;
  const [form,setForm]=useState({
    name:"",lrn:"",grade_level:gradeFilter||7,section_id:"",
    gender:"Male",birthday:"",address:"",email:"",password:"",
    tve_qualification:"",grade11_track:"",grade11_techpro_choice:"",grade12_track:"",
    curriculum:"regular"
  });
  const effectiveGrade=parseInt(gradeFilter||form.grade_level);
  const needsTve=effectiveGrade>=8&&effectiveGrade<=10; // TVE qualification applies to Grades 8-10 only
  const isGrade11=effectiveGrade===11;
  const isGrade12=effectiveGrade===12;
  const needsTechProChoice=isGrade11&&form.grade11_track==="TechPro";
  const availSections=gradeFilter
    ?sections.filter(s=>s.grade_level===parseInt(gradeFilter))
    :sections.filter(s=>s.grade_level===parseInt(form.grade_level));
  const isAls=form.curriculum==="als";
  const resetForm=()=>setForm({name:"",lrn:"",grade_level:gradeFilter||7,section_id:"",
    gender:"Male",birthday:"",address:"",email:"",password:"",
    tve_qualification:"",grade11_track:"",grade11_techpro_choice:"",grade12_track:"",
    curriculum:"regular"});
  const submit=()=>{
    if (needsTve&&!form.tve_qualification){
      alert("Please select the student's TVE Qualification."); return;
    }
    // ALS (old curriculum) does not use the regular Academic/TechPro/TVL
    // track structure — it has its own Learning Strands, so the track
    // dropdowns don't apply and aren't required for an ALS learner.
    if (!isAls&&isGrade11&&!form.grade11_track){
      alert("Please select the student's Grade 11 Track (Academic or TechPro)."); return;
    }
    if (!isAls&&needsTechProChoice&&!form.grade11_techpro_choice){
      alert("Please select the TechPro specialization (Bakery Operations or Organic Agriculture Production)."); return;
    }
    if (!isAls&&isGrade12&&!form.grade12_track){
      alert("Please select the student's Grade 12 Track (TVL-AFA or TVL-HE)."); return;
    }
    // Build a single shs_track label for storage, e.g.
    // "TechPro - Organic Agriculture Production" or "Academic" or "TVL-AFA"
    let shsTrack=null;
    if (!isAls&&isGrade11) {
      shsTrack=form.grade11_track==="TechPro"
        ?`TechPro - ${form.grade11_techpro_choice}`
        :"Academic";
    } else if (!isAls&&isGrade12) {
      shsTrack=form.grade12_track;
    }
    onAdd({
      ...form,
      tve_qualification:needsTve?form.tve_qualification:null,
      shs_track:shsTrack,
      curriculum:(isGrade11||isGrade12)?form.curriculum:"regular",
    });
    resetForm();
  };
  return (
    <Card style={{marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Student</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div style={{display:"grid",gap:4}}>
          <input placeholder="Student Name * (e.g. DELA CRUZ, JUAN, D.)" value={form.name}
            onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
          {form.name.includes(",")&&<div style={{fontSize:10,color:T.green2}}>Display preview: <strong>{displayStudentName(form.name)}</strong> · Official SF2/SF9 will retain the encoded name order.</div>}
        </div>
        <input placeholder="LRN (12 digits) *" value={form.lrn} maxLength={12}
          onChange={e=>setForm(p=>({...p,lrn:e.target.value}))}/>
        {!gradeFilter&&(
          <select value={form.grade_level}
            onChange={e=>setForm(p=>({...p,grade_level:e.target.value,section_id:"",
              tve_qualification:"",grade11_track:"",grade11_techpro_choice:"",grade12_track:""}))}>
            {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
          </select>
        )}
        <select value={form.section_id}
          onChange={e=>setForm(p=>({...p,section_id:e.target.value}))}>
          <option value="">-- Section --</option>
          {availSections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={form.gender} onChange={e=>setForm(p=>({...p,gender:e.target.value}))}>
          <option>Male</option><option>Female</option>
        </select>
        <input type="date" value={form.birthday}
          onChange={e=>setForm(p=>({...p,birthday:e.target.value}))}/>
        <input placeholder="Email *" value={form.email}
          onChange={e=>setForm(p=>({...p,email:e.target.value}))}/>
        <input type="password" placeholder="Password *" value={form.password}
          onChange={e=>setForm(p=>({...p,password:e.target.value}))}/>
        {needsTve&&(
          <select value={form.tve_qualification}
            onChange={e=>setForm(p=>({...p,tve_qualification:e.target.value}))}
            style={{gridColumn:"1 / -1"}}>
            <option value="">-- TVE Qualification * --</option>
            {tveOptions.map(q=><option key={q} value={q}>{q}</option>)}
          </select>
        )}
        {(isGrade11||isGrade12)&&(
          <select value={form.curriculum}
            onChange={e=>setForm(p=>({...p,curriculum:e.target.value,
              grade11_track:"",grade11_techpro_choice:"",grade12_track:""}))}
            style={{gridColumn:"1 / -1"}}>
            <option value="regular">Curriculum: Regular (standard DepEd K-12)</option>
            <option value="als">Curriculum: ALS (Alternative Learning System)</option>
          </select>
        )}
        {!isAls&&isGrade11&&(
          <>
            <select value={form.grade11_track}
              onChange={e=>setForm(p=>({...p,grade11_track:e.target.value,grade11_techpro_choice:""}))}
              style={{gridColumn:needsTechProChoice?"auto":"1 / -1"}}>
              <option value="">-- Grade 11 Track * --</option>
              {GRADE11_TRACKS.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            {needsTechProChoice&&(
              <select value={form.grade11_techpro_choice}
                onChange={e=>setForm(p=>({...p,grade11_techpro_choice:e.target.value}))}>
                <option value="">-- TechPro Specialization * --</option>
                {GRADE11_TECHPRO_SUBCHOICES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </>
        )}
        {!isAls&&isGrade12&&(
          <select value={form.grade12_track}
            onChange={e=>setForm(p=>({...p,grade12_track:e.target.value}))}
            style={{gridColumn:"1 / -1"}}>
            <option value="">-- Grade 12 Track * --</option>
            {GRADE12_TRACKS.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      <input placeholder="Address" value={form.address}
        onChange={e=>setForm(p=>({...p,address:e.target.value}))} style={{marginBottom:10}}/>
      <Btn onClick={submit} disabled={loading} style={{width:"100%"}}>
        {loading?"⏳ Adding...":"➕ Add Student"}
      </Btn>
    </Card>
  );
};

const EditStudentModal = ({ student, sections, qualifications=[], canChangeGrade=false, onSave, onClose }) => {
  const [form,setForm]=useState({
    name:student.name||"", lrn:student.lrn||"", gender:student.gender||"Male",
    birthday:student.birthday||"", address:student.address||"",
    grade_level:student.grade_level, section_id:student.section_id||"",
    tve_qualification:student.tve_qualification||"", shs_track:student.shs_track||"",
    enrollment_status:student.enrollment_status||"Active", status_date:student.status_date||"",
    curriculum:student.curriculum||"regular",
  });
  const [saving,setSaving]=useState(false);
  const gradeLevel=parseInt(form.grade_level);
  const needsTve=gradeLevel>=8&&gradeLevel<=10;
  const isGrade11=gradeLevel===11, isGrade12=gradeLevel===12;
  const tveOptions=(qualifications&&qualifications.length>0)?qualifications:TVE_QUALIFICATIONS_FALLBACK;
  const availSections=sections.filter(s=>s.grade_level===gradeLevel);

  const submit=async()=>{
    if (!form.name.trim()||!form.lrn.trim()){alert("Name and LRN are required.");return;}
    if (needsTve&&!form.tve_qualification){alert("Please select the TVE Qualification.");return;}
    if (form.enrollment_status!=="Active"&&!form.status_date){
      alert("Please set the date for this status (needed for School Form 4).");return;
    }
    setSaving(true);
    await onSave({
      name:form.name.trim(), lrn:form.lrn.trim(), gender:form.gender,
      birthday:form.birthday||null, address:form.address||null,
      section_id:form.section_id||null,
      tve_qualification:needsTve?form.tve_qualification:null,
      shs_track:(isGrade11||isGrade12)?(form.shs_track||null):null,
      curriculum:(isGrade11||isGrade12)?form.curriculum:"regular",
      grade_level:canChangeGrade?gradeLevel:undefined,
      enrollment_status:form.enrollment_status,
      status_date:form.enrollment_status==="Active"?null:form.status_date,
    });
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:250,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card className="dialog-md" style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>✏️ Edit Learner</div>
        <div style={{fontSize:11,color:T.textMuted,marginBottom:12}}>
          Correct any encoding errors below, then save.
        </div>
        <div style={{display:"grid",gap:8,marginBottom:8}}>
          <div style={{display:"grid",gap:4}}>
            <input placeholder="Student Name * (e.g. DELA CRUZ, JUAN, D.)" value={form.name}
              onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
            {form.name.includes(",")&&<div style={{fontSize:10,color:T.green2}}>Display preview: <strong>{displayStudentName(form.name)}</strong> · Official SF2/SF9 will retain the encoded name order.</div>}
          </div>
          <input placeholder="LRN (12 digits) *" value={form.lrn} maxLength={12}
            onChange={e=>setForm(p=>({...p,lrn:e.target.value}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <select value={form.gender} onChange={e=>setForm(p=>({...p,gender:e.target.value}))}>
              <option>Male</option><option>Female</option>
            </select>
            <input type="date" value={form.birthday}
              onChange={e=>setForm(p=>({...p,birthday:e.target.value}))}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {canChangeGrade?(
              <select value={form.grade_level}
                onChange={e=>setForm(p=>({...p,grade_level:e.target.value,section_id:"",
                  tve_qualification:"",shs_track:""}))}>
                {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
              </select>
            ):(
              <div style={{fontSize:12,color:T.textMuted,display:"flex",alignItems:"center",padding:"0 4px"}}>
                Grade {gradeLevel} (fixed)
              </div>
            )}
            <select value={form.section_id}
              onChange={e=>setForm(p=>({...p,section_id:e.target.value}))}>
              <option value="">-- Section --</option>
              {availSections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {needsTve&&(
            <select value={form.tve_qualification}
              onChange={e=>setForm(p=>({...p,tve_qualification:e.target.value}))}>
              <option value="">-- TVE Qualification * --</option>
              {tveOptions.map(q=><option key={q} value={q}>{q}</option>)}
            </select>
          )}
          {(isGrade11||isGrade12)&&(
            <>
              <select value={form.curriculum}
                onChange={e=>setForm(p=>({...p,curriculum:e.target.value}))}>
                <option value="regular">Curriculum: Regular (standard DepEd K-12)</option>
                <option value="als">Curriculum: ALS (Alternative Learning System)</option>
              </select>
              <input placeholder="SHS Track" value={form.shs_track}
                onChange={e=>setForm(p=>({...p,shs_track:e.target.value}))}/>
            </>
          )}
          <input placeholder="Address" value={form.address}
            onChange={e=>setForm(p=>({...p,address:e.target.value}))}/>

          <div style={{borderTop:"1px solid #E3EEDD",paddingTop:8,marginTop:2}}>
            <label style={{fontSize:11,color:T.textMuted,display:"block",marginBottom:4}}>
              Enrollment Status — used in School Form 4
            </label>
            <div style={{display:"grid",gridTemplateColumns:form.enrollment_status==="Active"?"1fr":"1fr 1fr",gap:8}}>
              <select value={form.enrollment_status}
                onChange={e=>setForm(p=>({...p,enrollment_status:e.target.value}))}>
                <option>Active</option>
                <option>Transferred In</option>
                <option>Transferred Out</option>
                <option>Dropped Out</option>
                <option>Deceased</option>
              </select>
              {form.enrollment_status!=="Active"&&(
                <input type="date" value={form.status_date}
                  onChange={e=>setForm(p=>({...p,status_date:e.target.value}))}/>
              )}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={submit} disabled={saving} style={{flex:1}}>
            {saving?"⏳ Saving...":"💾 Save Changes"}
          </Btn>
          <Btn onClick={onClose} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
};

const EditTeacherModal = ({ teacher, onSave, onClose }) => {
  const [form,setForm]=useState({ name:teacher.name||"" });
  const [saving,setSaving]=useState(false);

  const submit=async()=>{
    if (!form.name.trim()){alert("Name is required.");return;}
    setSaving(true);
    await onSave({ name:form.name.trim() });
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:250,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card className="dialog-sm" style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>✏️ Edit Teacher</div>
        <div style={{fontSize:11,color:T.textMuted,marginBottom:12}}>
          {teacher.email} — email and password are changed separately (🔑 reset password).
        </div>
        <div style={{display:"grid",gap:8,marginBottom:12}}>
          <input placeholder="Full Name *" value={form.name}
            onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={submit} disabled={saving} style={{flex:1}}>
            {saving?"⏳ Saving...":"💾 Save Changes"}
          </Btn>
          <Btn onClick={onClose} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
};

const EditSectionModal = ({ section, onSave, onClose }) => {
  const [form,setForm]=useState({
    name:section.name||"", grade_level:section.grade_level,
  });
  const [saving,setSaving]=useState(false);

  const submit=async()=>{
    if (!form.name.trim()){alert("Section name is required.");return;}
    setSaving(true);
    await onSave({ name:form.name.trim(), grade_level:parseInt(form.grade_level) });
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:250,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card className="dialog-sm" style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>✏️ Edit Section</div>
        <div style={{fontSize:11,color:T.textMuted,marginBottom:12}}>
          Changing the grade level moves this section (and its students) to that grade.
        </div>
        <div style={{display:"grid",gap:8,marginBottom:12}}>
          <input placeholder="Section Name *" value={form.name}
            onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
          <select value={form.grade_level}
            onChange={e=>setForm(p=>({...p,grade_level:e.target.value}))}>
            {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={submit} disabled={saving} style={{flex:1}}>
            {saving?"⏳ Saving...":"💾 Save Changes"}
          </Btn>
          <Btn onClick={onClose} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
};

const EditSubjectModal = ({ subject, isMapeh, onSave, onClose, qualifications=[] }) => {
  const [form,setForm]=useState({
    name:subject.name||"", grade_level:subject.grade_level,
    tve_qualification:subject.tve_qualification||"",
    term:subject.term?String(subject.term):"", curriculum:subject.curriculum||"regular",
    shs_track:subject.shs_track||"",
  });
  const [saving,setSaving]=useState(false);
  const isTveGrade=parseInt(form.grade_level)>=8&&parseInt(form.grade_level)<=10;
  const isShsGrade=parseInt(form.grade_level)===11||parseInt(form.grade_level)===12;
  const isAlsSubject=form.curriculum==="als";

  const submit=async()=>{
    if (!form.name.trim()){alert("Subject name is required.");return;}
    setSaving(true);
    await onSave({
      name:form.name.trim(),
      grade_level:parseInt(form.grade_level),
      // A subject only stays scoped to a TVE qualification while both a grade
      // level of 8–10 AND an explicit qualification are selected. Moving the
      // subject out of Grades 8–10 (or clearing the dropdown) always clears
      // the tag — this is the only place in the app that can undo a subject
      // getting stuck pointing at the wrong qualification's roster.
      tve_qualification:isTveGrade&&form.tve_qualification?form.tve_qualification:null,
      // Term, curriculum, and track only mean anything for Grades 11-12 —
      // moving a subject out of SHS clears all three, same reasoning as TVE
      // above. Track also doesn't apply to ALS (no Academic/TechPro/TVL
      // structure there), so it's cleared whenever curriculum is ALS too.
      term:isShsGrade&&form.term?parseInt(form.term):null,
      curriculum:isShsGrade&&form.curriculum==="als"?"als":"regular",
      shs_track:isShsGrade&&!isAlsSubject&&form.shs_track?form.shs_track:null,
    });
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:250,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card className="dialog-sm" style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>✏️ Edit Subject</div>
        {isMapeh&&(
          <div style={{fontSize:11,color:T.textMuted,marginBottom:12}}>
            This is the MAPEH parent — its name is locked, but you can still move its
            grade level (its PE and Health / Music and Arts components move with it).
          </div>
        )}
        <div style={{display:"grid",gap:8,marginBottom:12}}>
          <input placeholder="Subject Name *" value={form.name} disabled={isMapeh}
            onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
          <select value={form.grade_level}
            onChange={e=>setForm(p=>({...p,grade_level:e.target.value}))}>
            {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
          </select>
          {isTveGrade&&(
            <div>
              <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",marginBottom:4}}>
                TVE QUALIFICATION SCOPE
              </label>
              <select value={form.tve_qualification}
                onChange={e=>setForm(p=>({...p,tve_qualification:e.target.value}))}>
                <option value="">— None (visible to all students in the section) —</option>
                {qualifications.map(q=><option key={q} value={q}>{q}</option>)}
              </select>
              <div style={{fontSize:10,color:T.textMuted,marginTop:4}}>
                Only set this for subjects that are specific to one TVE qualification
                (e.g. "TVE-AgriCrop Production"). Regular subjects like Science or
                Mathematics should stay set to "None" so every student in the section
                shows up, regardless of their qualification track.
              </div>
            </div>
          )}
          {isShsGrade&&(
            <div>
              <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",marginBottom:4}}>
                TERM SCOPE (SHS ONLY)
              </label>
              <select value={form.term}
                onChange={e=>setForm(p=>({...p,term:e.target.value}))}>
                <option value="">-- All terms (default) --</option>
                <option value="1">Term 1 only</option>
                <option value="2">Term 2 only</option>
                <option value="3">Term 3 only</option>
              </select>
              <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",margin:"8px 0 4px"}}>
                CURRICULUM
              </label>
              <select value={form.curriculum}
                onChange={e=>setForm(p=>({...p,curriculum:e.target.value,shs_track:""}))}>
                <option value="regular">Regular (standard DepEd K-12)</option>
                <option value="als">ALS (Alternative Learning System)</option>
              </select>
              {!isAlsSubject&&(
                <>
                  <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",margin:"8px 0 4px"}}>
                    TRACK SCOPE
                  </label>
                  <select value={form.shs_track}
                    onChange={e=>setForm(p=>({...p,shs_track:e.target.value}))}>
                    <option value="">-- All tracks (default) --</option>
                    {(parseInt(form.grade_level)===11?GRADE11_TRACKS:GRADE12_TRACKS)
                      .map(t=><option key={t} value={t}>{t} only</option>)}
                  </select>
                </>
              )}
              <div style={{fontSize:10,color:T.textMuted,marginTop:4}}>
                Term scope: leave as "All terms" for a subject that runs the whole year.
                Set to one term for a subject that only exists in that term.
                Curriculum: ALS subjects are only seen by learners marked ALS, and vice versa
                for Regular — the two subject lists never mix even within the same grade level.
                Track scope: leave as "All tracks" for a subject every learner in the grade
                takes; set it to one track (e.g. "TechPro only") so it never shows up for
                learners on a different track sharing the same section.
              </div>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={submit} disabled={saving} style={{flex:1}}>
            {saving?"⏳ Saving...":"💾 Save Changes"}
          </Btn>
          <Btn onClick={onClose} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
};

const SectionGroup = ({ sectionName, adviserName, total, males, females, qualStats, children }) => {
  const [open,setOpen]=useState(true);
  return (
    <div style={{marginBottom:12}}>
      <div onClick={()=>setOpen(p=>!p)} style={{cursor:"pointer",fontSize:12,fontWeight:700,
        color:T.green2,background:"#EEF6EC",padding:"6px 10px",borderRadius:6,
        borderLeft:`3px solid ${T.green3}`,marginBottom:6,display:"flex",
        justifyContent:"space-between",alignItems:"center",gap:8}}>
        <span style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:10}}>{open?"▼":"▶"}</span>
          <span>Section: {sectionName}</span>
        </span>
        {adviserName&&<span style={{fontSize:10,color:T.textMuted,fontWeight:400}}>Adviser: {adviserName}</span>}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:open?8:0,paddingLeft:2}}>
        <span style={{fontSize:10,fontWeight:700,color:T.text,background:"#fff",
          border:"1px solid #C9E0BE",borderRadius:10,padding:"2px 8px"}}>
          👥 Total: {total}
        </span>
        <span style={{fontSize:10,fontWeight:700,color:T.blue,background:"#fff",
          border:"1px solid #b3c6e8",borderRadius:10,padding:"2px 8px"}}>
          ♂ Male: {males}
        </span>
        <span style={{fontSize:10,fontWeight:700,color:"#c2185b",background:"#fff",
          border:"1px solid #eab8cc",borderRadius:10,padding:"2px 8px"}}>
          ♀ Female: {females}
        </span>
        {qualStats.map(g=>(
          <span key={g.name} style={{fontSize:10,fontWeight:700,color:"#7b1fa2",background:"#fff",
            border:"1px solid #d8b8d8",borderRadius:10,padding:"2px 8px"}}>
            🎯 {g.name}: {g.count}
          </span>
        ))}
      </div>
      {open&&children}
    </div>
  );
};

const StudentListGrouped = ({ students, sections, teachers, showActions, onDelete, onReset, onReassign, onEdit, qualifications=[] }) => (
  <div>
    {GRADE_LEVELS.map(gl=>{
      const gradeSections=sections.filter(s=>s.grade_level===gl);
      const gradeStudents=students.filter(s=>s.grade_level===gl);
      if (!gradeStudents.length) return null;
      const isTveGrade=gl>=8&&gl<=10; // TVE qualification only applies to Grades 8-10
      return (
        <div key={gl} style={{marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:800,color:T.white,
            background:T.green1,padding:"6px 12px",borderRadius:8,marginBottom:8}}>
            Grade {gl}
          </div>
          {gradeSections.map(sec=>{
            const secStudents=gradeStudents.filter(s=>s.section_id===sec.id);
            if (!secStudents.length) return null;
            const adviser=teachers.find(t=>t.id===sec.adviser_id);

            // Renders the Male / Female sub-groups for a given list of students.
            const renderGenderGroups=list=>{
              const males=list.filter(s=>s.gender==="Male");
              const females=list.filter(s=>s.gender==="Female");
              return (
                <>
                  {males.length>0&&(
                    <div>
                      <div style={{fontSize:11,color:T.blue,fontWeight:700,padding:"2px 8px",
                        marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                        <span>♂</span><span>Male ({males.length})</span>
                      </div>
                      {males.map(s=><StudentCard key={s.id} student={s} sections={sections}
                        showActions={showActions} onDelete={onDelete} onReset={onReset} onReassign={onReassign} onEdit={onEdit}/>)}
                    </div>
                  )}
                  {females.length>0&&(
                    <div style={{marginTop:4}}>
                      <div style={{fontSize:11,color:"#c2185b",fontWeight:700,padding:"2px 8px",
                        marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                        <span>♀</span><span>Female ({females.length})</span>
                      </div>
                      {females.map(s=><StudentCard key={s.id} student={s} sections={sections}
                        showActions={showActions} onDelete={onDelete} onReset={onReset} onReassign={onReassign} onEdit={onEdit}/>)}
                    </div>
                  )}
                </>
              );
            };

            // For Grades 8-10, break the section's students down per TVE qualification
            // (per admin-managed list), so admin can see exactly who belongs to which
            // qualification within this section. Other grades show gender groups directly.
            const qualGroups=isTveGrade
              ?[...qualifications,
                ...(secStudents.some(s=>!s.tve_qualification||!qualifications.includes(s.tve_qualification))
                  ?["Unassigned / Other"]:[])
                ].map(qName=>({
                  name:qName,
                  list:qName==="Unassigned / Other"
                    ?secStudents.filter(s=>!s.tve_qualification||!qualifications.includes(s.tve_qualification))
                    :secStudents.filter(s=>s.tve_qualification===qName),
                })).filter(g=>g.list.length>0)
              :null;

            const males=secStudents.filter(s=>s.gender==="Male").length;
            const females=secStudents.filter(s=>s.gender==="Female").length;
            const qualStats=isTveGrade
              ?qualifications.map(qName=>({
                  name:qName,
                  count:secStudents.filter(s=>s.tve_qualification===qName).length,
                })).filter(g=>g.count>0)
              :[];

            return (
              <SectionGroup key={sec.id} sectionName={sec.name} adviserName={adviser?.name}
                total={secStudents.length} males={males} females={females} qualStats={qualStats}>
                {qualGroups?(
                  qualGroups.map(g=>(
                    <div key={g.name} style={{marginBottom:10,marginLeft:4,paddingLeft:8,
                      borderLeft:"2px solid #A9CB9C"}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#7b1fa2",background:"#f3e5f5",
                        padding:"3px 9px",borderRadius:6,marginBottom:6,display:"inline-block"}}>
                        🎯 {g.name} ({g.list.length})
                      </div>
                      {renderGenderGroups(g.list)}
                    </div>
                  ))
                ):renderGenderGroups(secStudents)}
              </SectionGroup>
            );
          })}
          {gradeStudents.filter(s=>!s.section_id).length>0&&(
            <div style={{marginBottom:8}}>
              <div style={{fontSize:12,color:T.gray,padding:"2px 8px",marginBottom:4}}>
                No Section Assigned
              </div>
              {gradeStudents.filter(s=>!s.section_id).map(s=>
                <StudentCard key={s.id} student={s} sections={sections}
                  showActions={showActions} onDelete={onDelete} onReset={onReset} onReassign={onReassign} onEdit={onEdit}/>
              )}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

const StudentCard = ({ student:s, sections, showActions, onDelete, onReset, onReassign, onEdit }) => {
  const [expand,setExpand]=useState(false);
  const sec=sections.find(x=>x.id===s.section_id);
  return (
    <Card style={{marginBottom:6,padding:"8px 12px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1}} onClick={()=>setExpand(p=>!p)}>
          <div style={{fontWeight:700,fontSize:13,color:T.text}}>{studentDisplay(s)}</div>
          <div style={{fontSize:11,color:T.textMuted,display:"flex",gap:8,flexWrap:"wrap"}}>
            <span>LRN: {s.lrn}</span><span>Gr.{s.grade_level}</span>
            {sec&&<span>{sec.name}</span>}
            <Badge text={s.gender} color={s.gender==="Male"?T.blue:"#c2185b"}/>
            {s.tve_qualification&&<Badge text={s.tve_qualification} color="#7b1fa2"/>}
            {s.enrollment_status&&s.enrollment_status!=="Active"&&
              <Badge text={s.enrollment_status} color={T.red}/>}
          </div>
        </div>
        {(showActions||onEdit)&&(
          <div style={{display:"flex",gap:4,flexShrink:0}}>
            {onEdit&&(
              <Btn color={T.green3} style={{padding:"5px 8px",fontSize:11}}
                onClick={()=>onEdit(s)}>✏️</Btn>
            )}
            {showActions&&<>
              <Btn color={T.blue} style={{padding:"5px 8px",fontSize:11}}
                onClick={()=>onReset({userId:s.id,name:s.name,role:"student"})}>🔑</Btn>
              <Btn color={T.red} style={{padding:"5px 8px",fontSize:11}}
                onClick={()=>onDelete(s.id)}>🗑️</Btn>
            </>}
          </div>
        )}
      </div>
      {expand&&(
        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #E3EEDD"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:11}}>
            {[["Birthday",s.birthday||"—"],["Address",s.address||"—"],["Email",s.email||"—"]].map(([k,v])=>(
              <div key={k}><span style={{color:T.textMuted}}>{k}: </span>
                <span style={{color:T.text}}>{v}</span></div>
            ))}
          </div>
          {onReassign&&(
            <div style={{marginTop:8}}>
              <label style={{fontSize:11,color:T.textMuted,display:"block",marginBottom:4}}>
                Reassign Section:
              </label>
              <select value={s.section_id||""} style={{fontSize:12,padding:"5px 8px"}}
                onChange={e=>onReassign(s.id,e.target.value)}>
                <option value="">-- No Section --</option>
                {sections.filter(x=>x.grade_level===s.grade_level).map(x=>(
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── SCHOOL CALENDAR PANEL (fixed — no hooks in map) ────


const DASIG_QUOTES = [
  "Small steps lead to big dreams. Keep going, Agrian!",
  "Discipline today becomes success tomorrow. Dasig!",
  "Plant the seeds of greatness through your daily effort.",
  "Your future is growing from what you do today.",
  "Progress is progress—even one point higher is worth celebrating!",
  "You do not have to be perfect. You just have to keep growing.",
  "Believe in yourself, Agrian. Your hard work has a purpose.",
  "Every school day is another chance to grow, learn, and shine.",
  "Keep your roots strong, your goals clear, and your heart brave.",
  "Dasig, Agrian! Your little improvements are becoming a big harvest."
];

const getDasigDailyQuote = (seed="agrian") => {
  const day=Math.floor(Date.now()/86400000);
  let hash=0;
  for (const ch of String(seed)) hash=(hash*31+ch.charCodeAt(0))>>>0;
  return DASIG_QUOTES[(day+hash)%DASIG_QUOTES.length];
};

const getBirthdayMessage = birthday => {
  if (!birthday) return null;
  const value=String(birthday).slice(0,10);
  const parts=value.split("-").map(Number);
  if (parts.length!==3 || !parts[1] || !parts[2]) return null;
  const now=new Date();
  return parts[1]===now.getMonth()+1 && parts[2]===now.getDate()
    ? "Happy Birthday, Agrian! May this new year of your life bring you more learning, laughter, and wonderful harvests! 🎂🌱"
    : null;
};

// `statusAverage` must be the same "current performance" value used to drive
// the companion's headline (attendanceEngine.learnerStatus) — previously this
// checked the cumulative `average` for Honor but fell back to `termAverage`
// for Almost Honor, so a learner whose latest term already reached 90+ (and
// whose companion headline already said "Congratulations, Honor Agrian!")
// could simultaneously see an "Almost Honor" badge because their older,
// lower cumulative average hadn't crossed 90 yet. Using one resolved value
// for both keeps the headline and the badges from disagreeing.
const buildDasigAchievements = ({ statusAverage, attendancePct, termAverage, previousAverage }) => {
  const items=[];
  if (statusAverage!=null && statusAverage>=90) items.push({icon:"🏆",title:"Honor Agrian",text:"Your current academic average is at or above 90."});
  else if (statusAverage!=null && statusAverage>=88) items.push({icon:"🌟",title:"Almost Honor",text:"You are within reach of the 90 honor benchmark."});
  if (attendancePct!=null && attendancePct>=95) items.push({icon:"🗓️",title:"Attendance Hero",text:"95%+ attendance shows strong consistency."});
  if (previousAverage!=null && termAverage!=null && termAverage>previousAverage) items.push({icon:"📈",title:"Growing Agrian",text:`Your latest term is up ${Math.round((termAverage-previousAverage)*10)/10} points.`});
  if (!items.length) items.push({icon:"🌱",title:"Keep Planting",text:"Every completed activity and every school day moves you forward."});
  return items.slice(0,3);
};

const DASIG_JOURNEY_KEY = profileId => `mcpbahs:dasig-journey:${profileId}`;

const loadDasigJourneyLocal = profileId => {
  try {
    const raw = localStorage.getItem(DASIG_JOURNEY_KEY(profileId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const saveDasigJourneyLocal = (profileId, events) => {
  try { localStorage.setItem(DASIG_JOURNEY_KEY(profileId), JSON.stringify(events.slice(0, 36))); }
  catch { /* DASIG still works if browser storage is unavailable */ }
};

const journeyEvent = (key, title, text, icon, metadata={}) => ({
  key, title, text, icon, metadata, at: new Date().toISOString()
});

// Cloud memory is the durable source for DASIG milestones. Local storage is
// retained as a graceful offline fallback so the companion never feels empty.
const loadDasigJourneyCloud = async profileId => {
  if (!profileId) return [];
  const {data,error}=await supabase.from("dasig_journey_events")
    .select("event_key,title,body,icon,metadata,created_at")
    .eq("student_id",profileId)
    .order("created_at",{ascending:false})
    .limit(36);
  if (error) throw error;
  return (data||[]).map(e=>({key:e.event_key,title:e.title,text:e.body,icon:e.icon,metadata:e.metadata||{},at:e.created_at}));
};

const saveDasigJourneyCloud = async (profileId, events) => {
  if (!profileId || !events?.length) return;
  const rows=events.slice(0,36).map(e=>({
    student_id:profileId,event_key:e.key,title:e.title,body:e.text,icon:e.icon,
    metadata:e.metadata||{},created_at:e.at||new Date().toISOString()
  }));
  const {error}=await supabase.from("dasig_journey_events").upsert(rows,{onConflict:"student_id,event_key"});
  if (error) throw error;
};

const DasigJourney = ({ profile, termAverages, average, attendancePct, currentStatus }) => {
  const [events,setEvents]=useState(()=>loadDasigJourneyLocal(profile?.id));
  const [memoryState,setMemoryState]=useState("local");
  const termSignature=termAverages.join('|');

  useEffect(()=>{
    let cancelled=false;
    if (!profile?.id) return undefined;
    (async()=>{
      try {
        const cloud=await loadDasigJourneyCloud(profile.id);
        if (!cancelled && cloud.length) {
          setEvents(cloud);
          saveDasigJourneyLocal(profile.id,cloud);
        }
        if (!cancelled) setMemoryState("cloud");
      } catch {
        if (!cancelled) setMemoryState("local");
      }
    })();
    return ()=>{cancelled=true;};
  },[profile?.id]);

  useEffect(()=>{
    if (!profile?.id) return;
    const existing=events.length?events:loadDasigJourneyLocal(profile.id);
    const next=[...existing];
    const add=(key,title,text,icon,metadata={})=>{
      if (!next.some(e=>e.key===key)) next.unshift(journeyEvent(key,title,text,icon,metadata));
    };
    add('first-login','Your journey began','DASIG is keeping a lasting record of your growth milestones.','🌱',{stage:'seedling'});
    if (average!=null && average>=90) add('honor-reached','Honor Agrian','You reached the 90+ academic benchmark. What a harvest!','🏆',{average});
    if (average!=null && average>=88 && average<90) add('almost-honor','Almost Honor','You entered the 88–89.99 range. You are getting close!','🌟',{average});
    if (attendancePct!=null && attendancePct>=95) add('attendance-hero','Attendance Hero','Your attendance reached 95% or higher. Consistency matters!','🗓️',{attendancePct});
    const completedTerms=termAverages.filter(v=>v!=null);
    if (completedTerms.length>=2 && completedTerms[completedTerms.length-1]>completedTerms[completedTerms.length-2]) {
      const key=`growth-term-${completedTerms.length}`;
      add(key,`Term ${completedTerms.length} growth`,`Your latest recorded term improved over the previous one.`,`📈`,{from:completedTerms[completedTerms.length-2],to:completedTerms[completedTerms.length-1]});
    }
    if (currentStatus==='rising') add('rising-now','Growing Agrian','DASIG noticed that your latest academic result is moving upward.','🌿',{average});
    const changed=JSON.stringify(next)!==JSON.stringify(existing);
    if (!changed) return;
    saveDasigJourneyLocal(profile.id,next);
    setEvents(next);
    // Persist in the background. If RLS/network prevents it, local memory remains usable.
    saveDasigJourneyCloud(profile.id,next).catch(()=>{});
  },[profile?.id,average,attendancePct,currentStatus,termSignature]);

  const milestoneMap = {
    seedling:{icon:'🌱',label:'Seedling'}, growing:{icon:'🌿',label:'Growing'},
    rising:{icon:'📈',label:'Rising Star'}, almost:{icon:'🌟',label:'Almost Honor'}, honor:{icon:'🏆',label:'Honor Agrian'}
  };
  const stage = currentStatus==='honor' ? 'honor' : currentStatus==='almost' ? 'almost' : currentStatus==='rising' ? 'rising' : (average!=null ? 'growing' : 'seedling');
  const stages=['seedling','growing','rising','almost','honor'];
  const stageIndex=stages.indexOf(stage);
  const bestAverage=Math.max(...events.map(e=>Number(e.metadata?.average)||0),Number(average)||0);
  const milestoneCount=events.filter(e=>e.key!=='first-login').length;

  return <Card className="dasig-journey-card">
    <div className="dasig-journey-head">
      <div><div className="dasig-panel-title">🌾 My Agrian Journey</div><small className="dasig-memory-status">{memoryState==='cloud'?'☁️ DASIG memory synced to your account':'📱 DASIG memory is available on this device'}</small></div>
      <div className="dasig-passport-stats"><span><b>{milestoneCount}</b><small>milestones</small></span><span><b>{bestAverage?bestAverage.toFixed(2):'—'}</b><small>best avg.</small></span></div>
    </div>
    <div className="dasig-journey-stages">
      {stages.map((key,i)=>{const m=milestoneMap[key];return <div key={key} className={`dasig-journey-stage ${i<=stageIndex?'reached':''} ${key===stage?'current':''}`}><span>{m.icon}</span><small>{m.label}</small></div>;})}
    </div>
    <div className="dasig-journey-timeline">
      {events.slice(0,6).map(e=><div className="dasig-journey-event" key={e.key}><span className="dasig-journey-event-icon">{e.icon}</span><div><b>{e.title}</b><small>{e.text}</small><time>{new Date(e.at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time></div></div>)}
    </div>
    <div className="dasig-journey-footer">DASIG remembers your milestones with your student account, so your journey can follow you to another device. Official grades and attendance remain separate school records.</div>
  </Card>;
};

const AgrianCompanion = ({ profile, average, termAverage, previousAverage=null, attendancePct=null, onOpenDasig }) => {
  const birthdayMessage=getBirthdayMessage(profile?.birthday);
  const statusAverage=termAverage ?? average;
  const status=attendanceEngine.learnerStatus(statusAverage,previousAverage);
  const [quote,setQuote]=useState(()=>getDasigDailyQuote(profile?.id||profile?.name));
  const [celebrate,setCelebrate]=useState(status.key==="honor"||status.key==="almost");

  useEffect(()=>{ setQuote(getDasigDailyQuote(profile?.id||profile?.name)); },[profile?.id,profile?.name]);
  useEffect(()=>{
    if (status.key==="honor"||status.key==="almost") {
      setCelebrate(true);
      const timer=setTimeout(()=>setCelebrate(false),4200);
      return ()=>clearTimeout(timer);
    }
    setCelebrate(false);
  },[status.key]);

  const achievements=buildDasigAchievements({statusAverage,attendancePct,termAverage,previousAverage});
  const honorGap=statusAverage==null?10:Math.max(0,90-statusAverage);
  const attendanceNote=attendancePct==null
    ?"Let's build a strong attendance habit."
    :attendancePct>=95
      ?"Amazing consistency! Keep showing up."
      :attendancePct>=90
        ?"You're doing well—protect that attendance streak!"
        :"Let's work on being present more often. Every school day counts.";

  return (
    <section className={`dasig-companion ${status.key}`}>
      <div className="dasig-companion-bg"/>
      {celebrate&&<div className="dasig-confetti" aria-hidden="true">✦ ✧ ✦ ✧ ✦ ✧ ✦</div>}
      <div className="dasig-companion-art">
        <div className="dasig-speech">{birthdayMessage||status.title}</div>
        <img src={dasigAgrianMascot} alt="DASIG Agrian study buddy" className="dasig-companion-mascot"/>
        <span className="dasig-orbit dasig-orbit-a">🌱</span>
        <span className="dasig-orbit dasig-orbit-b">🍃</span>
      </div>
      <div className="dasig-companion-body">
        <div className="dasig-kicker">DASIG, AGRIAN! <span>•</span> YOUR SCHOOL BUDDY</div>
        <h2>{birthdayMessage?"🎂 It's Your Special Day!":`${status.emoji} ${status.title}`}</h2>
        <p className="dasig-main-quote">“{birthdayMessage||quote}”</p>
        <div className="dasig-chip-row">
          <span>📊 {statusAverage!=null?`${Number(statusAverage).toFixed(2)} avg`:'No grades yet'}</span>
          <span>📅 {attendancePct!=null?`${attendancePct}% attendance`:'Attendance building'}</span>
        </div>
        <div className="dasig-goal">
          <div><b>{honorGap>0?`🌟 ${honorGap.toFixed(2)} points to 90`:"🏆 Honor benchmark reached!"}</b><small>{attendanceNote}</small></div>
          <div className="dasig-goal-track"><i style={{width:`${Math.min(100,Math.max(0,(Number(statusAverage)||0)/90*100))}%`}}/></div>
        </div>
        <div className="dasig-achievement-row">
          {achievements.map(a=><div className="dasig-mini-achievement" title={a.text} key={a.title}><span>{a.icon}</span><b>{a.title}</b></div>)}
        </div>
        <div className="dasig-actions">
          <button onClick={()=>setQuote(getDasigDailyQuote(`${profile?.id||profile?.name}-${Date.now()}`))}>💬 Cheer Me Up</button>
          <button onClick={onOpenDasig}>🌱 My DASIG Corner</button>
        </div>
      </div>
    </section>
  );
};

const CalendarPanel = ({ calendar, onSave, holidays=[], onAddHoliday, onDeleteHoliday }) => {
  const [daysMap, setDaysMap] = useState(() => {
    const m = {};
    TERM_MONTHS.forEach(tm => {
      const key = `${tm.month}-${tm.year}-${tm.term}`;
      m[key] = "";
    });
    return m;
  });
  const [holDate,setHolDate]=useState("");
  const [holLabel,setHolLabel]=useState("");

  // Sync calendar data into daysMap when it loads
  useEffect(() => {
    if (!calendar.length) return;
    setDaysMap(prev => {
      const next = { ...prev };
      TERM_MONTHS.forEach(tm => {
        const key = `${tm.month}-${tm.year}-${tm.term}`;
        const cal = calendar.find(c => c.month===tm.month && c.year===tm.year && c.term===tm.term);
        if (cal) next[key] = String(cal.school_days);
      });
      return next;
    });
  }, [calendar]);

  return (
    <div>
      <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:4}}>
        📅 School Calendar
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>
        The calendar is the single source of truth for school-day dates. Add holidays/suspensions here; the Daily Attendance grid, SF2, SF4, and learner attendance all calculate from the same date set.
        The saved school-day count is checked against the generated date grid before reports are produced.
      </div>
      {[1,2,3].map(term=>{
        const termLabel = term===1?"Term 1: June 8 – Sept 15, 2026"
          :term===2?"Term 2: Sept 16 – Dec 18, 2026"
          :"Term 3: Jan 4 – Apr 8, 2027";
        const termMonths = TERM_MONTHS.filter(m=>m.term===term);
        return (
          <div key={term} style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:T.white,
              background:term===1?T.green2:term===2?T.blue:"#7b1fa2",
              padding:"6px 12px",borderRadius:8,marginBottom:8}}>
              {termLabel}
            </div>
            {termMonths.map((m,i)=>{
              const key = `${m.month}-${m.year}-${m.term}`;
              return (
                <Card key={i} style={{marginBottom:6,padding:"10px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1,fontSize:13,fontWeight:600,color:T.text}}>{m.label}</div>
                    <input type="number" min="0" max="31" style={{width:70,textAlign:"center"}}
                      value={daysMap[key]||""}
                      onChange={e=>setDaysMap(p=>({...p,[key]:e.target.value}))}
                      placeholder="Days"/>
                    <Btn color={T.green3} style={{padding:"6px 10px",fontSize:12}}
                      onClick={()=>onSave(m.month,m.year,m.term,daysMap[key]||0)}>
                      💾
                    </Btn>
                  </div>
                  {(()=>{
                    const actual=attendanceEngine.dates(m,holidays).length;
                    const configured=parseInt(daysMap[key]||"0",10);
                    if (!configured) return null;
                    if (configured===actual) return <div style={{marginTop:6,fontSize:10.5,color:T.green2}}>✓ Calendar and date grid agree: {actual} school days.</div>;
                    return <div style={{marginTop:6,fontSize:10.5,color:"#9a6700",background:"#fff8df",border:"1px solid #f0d98a",borderRadius:6,padding:"6px 8px",lineHeight:1.45}}>
                      ⚠️ Configured: <strong>{configured}</strong> · Date grid: <strong>{actual}</strong>. Add/remove Non-School Days below so the dates and monthly count agree before generating SF2/SF4.
                    </div>;
                  })()}
                </Card>
              );
            })}
          </div>
        );
      })}

      {onAddHoliday&&(
        <div style={{marginTop:20}}>
          <div style={{fontSize:13,fontWeight:700,color:T.green1,marginBottom:4}}>
            🚫 Non-School Days (Holidays / Suspensions)
          </div>
          <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>
            These dates are automatically skipped in the Daily Attendance grid and School Form 2.
          </div>
          <Card style={{marginBottom:10}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <input type="date" style={{flex:"1 1 150px"}} value={holDate}
                onChange={e=>setHolDate(e.target.value)}/>
              <input placeholder="Label (e.g. Araw ng Kagitingan)" style={{flex:"2 1 200px"}}
                value={holLabel} onChange={e=>setHolLabel(e.target.value)}/>
              <Btn onClick={()=>{
                if (!holDate){return;}
                onAddHoliday(holDate,holLabel||"Holiday");
                setHolDate("");setHolLabel("");
              }} style={{flexShrink:0}}>➕ Add</Btn>
            </div>
          </Card>
          {holidays.length===0
            ?<Card><div style={{textAlign:"center",color:T.gray,padding:14,fontSize:12}}>
                No non-school days added yet.
              </div></Card>
            :[...holidays].sort((a,b)=>a.date.localeCompare(b.date)).map(h=>(
              <Card key={h.id} style={{marginBottom:6,padding:"8px 12px",display:"flex",
                justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:T.text}}>{h.date}</div>
                  <div style={{fontSize:11,color:T.textMuted}}>{h.label}</div>
                </div>
                <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                  onClick={()=>onDeleteHoliday(h.id)}>🗑️</Btn>
              </Card>
            ))
          }
        </div>
      )}
    </div>
  );
};

// ─── LOGIN ───────────────────────────────────────────────
const Login = () => {
  const [role,setRole]=useState("student");
  const [id,setId]=useState("");
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);

  const doLogin=async()=>{
    setErr(""); setLoading(true);
    try {
      if (role==="student") {
        const { data:lockSetting } = await supabase.from("app_settings")
          .select("value").eq("key","student_access_locked").single();
        if (lockSetting?.value==="true") {
          setErr("Student access is currently disabled. Please contact your school.");
          setLoading(false); return;
        }
        const {data,error}=await supabase.from("profiles").select("email")
          .eq("lrn",id).eq("role","student").single();
        if (error||!data){setErr("LRN not found.");setLoading(false);return;}
        const {error:e}=await supabase.auth.signInWithPassword({email:data.email,password:pass});
        if (e) setErr(e.message);
      } else {
        const {error}=await supabase.auth.signInWithPassword({email:id,password:pass});
        if (error) setErr(error.message);
      }
    } catch {setErr("Login failed. Please try again.");}
    setLoading(false);
  };

  const roleMeta = {
    student:{icon:"🎓",label:"Learner",hint:"Access grades, attendance, lessons and learning tools."},
    teacher:{icon:"👨‍🏫",label:"Teacher",hint:"Manage classes, attendance, grades and reports."},
    admin:{icon:"🛡️",label:"Administrator",hint:"Manage the school-wide academic records and settings."},
  };
  const meta=roleMeta[role];

  return (
    <div className="agrians-login">
      <div className="login-orb login-orb-a"/>
      <div className="login-orb login-orb-b"/>
      <div className="login-grid"/>
      <div className="login-header">
        <div className="login-school-mark">
          <img src={mcpbahsLogo} alt="MCPBAHS Logo"/>
        </div>
        <div>
          <div className="login-dep">DEPARTMENT OF EDUCATION · REGION XI · DAVAO REGION</div>
          <div className="login-school-name">Maria Cristina P. Belcar Agricultural High School</div>
          <div className="login-school-sub">School ID 304342 · S.Y. 2026–2027</div>
        </div>
      </div>

      <main className="login-main">
        <section className="login-brand-panel">
          <div className="login-brand-logo-wrap">
            <div className="login-ring"/>
            <img src={agriansLogo} alt="Project AGRIANS Logo" className="login-brand-logo"/>
          </div>
          <div className="login-project">Project <span>AGRIANS</span></div>
          <div className="login-fullname">Academic Grade Release &amp; Interactive Appointment Network System</div>
          <div className="login-tagline">No paper. No waiting. Just progress.</div>
          <div className="login-seed-line">
            <span>🌱</span><i/><span>📚</span><i/><span>📊</span><i/><span>🌾</span>
          </div>
          <p className="login-purpose">
            A unified digital platform for academic records, attendance, appointments and school reporting.
          </p>
        </section>

        <section className="login-card">
          <div className="login-card-top">
            <div>
              <div className="login-eyebrow">SECURE SCHOOL PORTAL</div>
              <h1>Welcome back</h1>
              <p>Choose your access level to continue.</p>
            </div>
            <div className="login-lock">🔐</div>
          </div>

          <div className="login-role-grid">
            {["student","teacher","admin"].map(r=>(
              <button key={r} type="button" className={`login-role ${role===r?"active":""}`}
                onClick={()=>{setRole(r);setErr("");}}>
                <span className="login-role-icon">{roleMeta[r].icon}</span>
                <span>{roleMeta[r].label}</span>
              </button>
            ))}
          </div>

          <div className="login-selected">
            <span>{meta.icon}</span>
            <div><b>{meta.label} access</b><small>{meta.hint}</small></div>
          </div>

          <label className="login-label">{role==="student"?"LRN (Learner Reference Number)":"Email Address"}</label>
          <div className="login-input-wrap">
            <span>{role==="student"?"🪪":"✉️"}</span>
            <input value={id} onChange={e=>setId(e.target.value)}
              placeholder={role==="student"?"Enter your 12-digit LRN":"e.g. user@mcpbahs.edu.ph"}
              onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
          </div>

          <label className="login-label">Password</label>
          <div className="login-input-wrap">
            <span>🔑</span>
            <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
              placeholder="Enter password" onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
          </div>

          {err&&<div className="login-error">⚠️ <span>{err}</span></div>}

          <button type="button" className="login-submit" onClick={doLogin} disabled={loading}>
            <span>{loading?"Authenticating…":"Sign in to AGRIANS"}</span>
            <b>{loading?"⏳":"→"}</b>
          </button>

          <div className="login-security">
            <span>●</span> Your credentials are protected by secure school authentication.
          </div>
        </section>
      </main>

      <footer className="login-footer">
        <span>Planting good seeds in the hearts of the learners.</span>
        <span>•</span>
        <span>AGRIANS Digital School Platform</span>
      </footer>
    </div>
  );
};

// ─── STUDENT DASHBOARD ───────────────────────────────────
const StudentDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("grades");
  const [dasigPulse,setDasigPulse]=useState(0);
  const [subjects,setSubjects]=useState([]);
  const [grades,setGrades]=useState([]);
  const [teachers,setTeachers]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [attendance,setAttendance]=useState([]); // legacy monthly summary (kept for backward compatibility)
  const [dailyAttendance,setDailyAttendance]=useState([]); // raw daily rows for fallback/detail
  const [canonicalAttendance,setCanonicalAttendance]=useState({}); // database source-of-truth summaries
  const [calendar,setCalendar]=useState([]);
  const [holidays,setHolidays]=useState([]);
  const [section,setSection]=useState(null);
  const [apptForm,setApptForm]=useState({teacherId:"",date:"",time:"",reason:""});
  const [apptMsg,setApptMsg]=useState("");
  const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState("");
  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),2500);};

  const fetchData=useCallback(async()=>{
    setLoading(true);
    const [sR,gR,tR,aR,dailyR,calR,holR,secR]=await Promise.all([
      supabase.from("subjects").select("*").eq("grade_level",profile.grade_level),
      supabase.from("grades").select("*").eq("student_id",profile.id),
      supabase.from("profiles").select("id,name").eq("role","teacher"),
      supabase.from("appointments").select("*").eq("student_id",profile.id),
      supabase.from("daily_attendance").select("student_id,date,status").eq("student_id",profile.id),
      supabase.from("school_calendar").select("*").order("year").order("month"),
      supabase.from("school_holidays").select("date").order("date"),
      profile.section_id
        ?supabase.from("sections").select("*").eq("id",profile.section_id).single()
        :{data:null},
    ]);
    if (sR.data) {
      // A student should only see TVE subjects matching their own qualification.
      // Non-TVE subjects (tve_qualification is null) are always visible.
      setSubjects(sR.data.filter(s=>
        !s.tve_qualification||s.tve_qualification===profile.tve_qualification));
    }
    if (gR.data) setGrades(gR.data);
    if (tR.data) setTeachers(tR.data);
    if (aR.data) setAppointments(aR.data);
    if (dailyR.data) setDailyAttendance(dailyR.data);
    if (calR.data) setCalendar(calR.data);
    if (holR.data) setHolidays(holR.data);
    if (secR.data) setSection(secR.data);
    setLoading(false);
  },[profile.id,profile.grade_level,profile.section_id,profile.tve_qualification]);

  useEffect(()=>{
    fetchData();
    const ch=supabase.channel("student-realtime")
      .on("postgres_changes",{event:"*",schema:"public",table:"grades",
        filter:`student_id=eq.${profile.id}`},()=>fetchData())
      .on("postgres_changes",{event:"*",schema:"public",table:"daily_attendance",
        filter:`student_id=eq.${profile.id}`},()=>fetchData())
      .on("postgres_changes",{event:"*",schema:"public",table:"dasig_journey_events",
        filter:`student_id=eq.${profile.id}`},()=>fetchData())
      .subscribe();
    return ()=>supabase.removeChannel(ch);
  },[fetchData,profile.id]);

  // Attendance Audit Pass: learner-facing monthly totals come from the same
  // database RPC consumed by the report generators. The local attendanceEngine
  // remains only as a compatibility fallback if an older deployment has not
  // applied the canonical migration yet.
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const entries=await Promise.all(TERM_MONTHS.map(async m=>{
        const {data,error}=await supabase.rpc("agrians_student_attendance_summary",{
          p_student_id:profile.id,p_month:m.month,p_year:m.year,p_term:m.term
        });
        return {key:`${m.month}-${m.year}-${m.term}`,row:Array.isArray(data)?data[0]:data,error};
      }));
      if(cancelled)return;
      const next={};
      entries.forEach(x=>{ if(!x.error&&x.row) next[x.key]=x.row; });
      setCanonicalAttendance(next);
    })();
    return ()=>{cancelled=true;};
  },[profile.id,dailyAttendance,calendar,holidays]);

  const getG=(subId,term)=>gradeForTerm(subjects.find(s=>s.id===subId),term,subjects,grades);
  const getFinal=subId=>avg([1,2,3].map(t=>getG(subId,t)).filter(Boolean));
  // MAPEH's two components feed into the MAPEH row itself — don't also
  // count them separately or they'd be averaged into the general average twice.
  const overallAvg=avg(subjects.filter(s=>!s.parent_subject_id).map(s=>getFinal(s.id)).filter(Boolean));
  const termAverages=[1,2,3].map(term=>avg(subjects.filter(s=>!s.parent_subject_id).map(s=>getG(s.id,term)).filter(Boolean)));
  const latestTermIndex=termAverages.reduce((last,v,i)=>v!=null?i:last,-1);
  const termAverage=latestTermIndex>=0?termAverages[latestTermIndex]:overallAvg;
  const previousAverage=latestTermIndex>0?termAverages[latestTermIndex-1]:null;

  // Attendance is derived from the same daily grid used by SF2. The old
  // monthly `attendance` table is deliberately NOT used for the student
  // dashboard because it can become stale when the calendar changes.
  const getMonthlyAttendance=(tm)=>{
    const key=`${tm.month}-${tm.year}-${tm.term}`;
    const row=canonicalAttendance[key];
    if(row) return {
      actual:Number(row.total_days)||0, configured:calendar.find(c=>c.month===tm.month&&c.year===tm.year&&c.term===tm.term)?.school_days,
      agreed:true, days:schoolDaysInMonth(tm,holidays), totalDays:Number(row.total_days)||0,
      totalPresent:Number(row.total_present)||0, absent:Number(row.absent)||0,
      pct:Number(row.attendance_pct)||0, encoded:!!row.encoded
    };
    return attendanceEngine.studentMonth(tm,calendar,holidays,dailyAttendance);
  };

  const getTermAttendance=term=>{
    const months=TERM_MONTHS.filter(m=>m.term===term);
    const rows=months.map(m=>canonicalAttendance[`${m.month}-${m.year}-${m.term}`]);
    if(rows.every(Boolean)){
      const totalDays=rows.reduce((n,r)=>n+(Number(r.total_days)||0),0);
      const totalPresent=rows.reduce((n,r)=>n+(Number(r.total_present)||0),0);
      const absent=rows.reduce((n,r)=>n+(Number(r.absent)||0),0);
      return {totalDays,totalPresent,absent,pct:totalDays?Math.round(totalPresent/totalDays*100):0,encoded:rows.some(r=>r.encoded)};
    }
    return attendanceEngine.term(term,calendar,holidays,dailyAttendance);
  };

  const submitAppt=async()=>{
    if (!apptForm.teacherId||!apptForm.date||!apptForm.time||!apptForm.reason){
      setApptMsg("❌ Please fill all fields."); return;
    }
    // Enforce max 3 appointments per day per teacher (Pending or Approved count toward the limit)
    const {count,error:countErr}=await supabase.from("appointments")
      .select("id",{count:"exact",head:true})
      .eq("teacher_id",apptForm.teacherId).eq("date",apptForm.date)
      .in("status",["Pending","Approved"]);
    if (countErr){setApptMsg("❌ "+countErr.message);return;}
    if ((count||0)>=3){
      setApptMsg("❌ This teacher already has 3 appointments booked on this date. Please choose another date.");
      return;
    }
    const teacher=teachers.find(t=>t.id===apptForm.teacherId);
    const {error}=await supabase.from("appointments").insert({
      student_id:profile.id,student_name:profile.name,
      teacher_id:apptForm.teacherId,teacher_name:teacher?.name||"",
      date:apptForm.date,time:apptForm.time,reason:apptForm.reason,status:"Pending",
    });
    if (error){setApptMsg("❌ "+error.message);return;}
    setApptMsg("✅ Appointment submitted!");
    setApptForm({teacherId:"",date:"",time:"",reason:""});
    fetchData(); setTimeout(()=>setApptMsg(""),3000);
  };

  if (loading) return <Spinner/>;

  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <SchoolHeader small/>
      <TopBar name={studentNameText(profile.name)}
        sub={`Grade ${profile.grade_level}${section?" – "+section.name:""} · LRN: ${profile.lrn}`}
        onLogout={onLogout}/>
      <div className="dashboard-scroll">
        <div className="dashboard-inner">
          <WelcomePanel profile={profile} role="student" stats={[
            {icon:"📊",value:overallAvg||"—",label:"General average"},
            {icon:"📚",value:subjects.filter(s=>!s.parent_subject_id).length,label:"Subjects"},
            {icon:"🏫",value:section?.name||"—",label:"Section"}
          ]}/>
          {(()=>{
            const latestAttendance=latestTermIndex>=0?getTermAttendance(latestTermIndex+1):getTermAttendance(1);
            return <AgrianCompanion profile={profile} average={overallAvg} termAverage={termAverage}
              previousAverage={previousAverage} attendancePct={latestAttendance.totalDays?latestAttendance.pct:null}
              onOpenDasig={()=>{setDasigPulse(p=>p+1);setTab("dasig");}}/>;
          })()}
          <div key={tab} className="tab-scene">

        {tab==="dasig"&&(
          <div className="dasig-corner" key={dasigPulse}>
            <SectionHeading eyebrow="YOUR AGRIAN COMPANION" title="DASIG Corner" action={<Badge text="Always cheering for you" color={T.green3}/>}/>
            <Card className="dasig-quote-card">
              <div className="dasig-quote-mascot"><img src={dasigAgrianMascot} alt="DASIG Agrian"/></div>
              <div><div className="dasig-kicker">TODAY'S DASIG MESSAGE</div><h3>“{getDasigDailyQuote(profile?.id||profile?.name)}”</h3><p>You have a buddy here to celebrate your wins, notice your progress, and remind you that one difficult day does not define your journey.</p></div>
            </Card>
            <div className="dasig-corner-grid">
              <Card><div className="dasig-panel-title">🏆 Your Growth Badges</div>
                {buildDasigAchievements({statusAverage:termAverage??overallAvg,attendancePct:latestTermIndex>=0?getTermAttendance(latestTermIndex+1).pct:null,termAverage,previousAverage}).map(a=>(
                  <div className="dasig-badge-row" key={a.title}><span>{a.icon}</span><div><b>{a.title}</b><small>{a.text}</small></div></div>
                ))}
              </Card>
              <Card><div className="dasig-panel-title">🌟 Your Next Harvest</div>
                <div className="dasig-goal-large"><ProgressRing value={termAverage||0} label="to 90" size={118}/><div><b>{termAverage==null?"Start planting your grades":termAverage>=90?"You've reached the honor benchmark!":`${(90-termAverage).toFixed(2)} points to 90`}</b><p>{termAverage==null?"Complete your first recorded assessment and DASIG will start tracking your growth.":"Focus on the subjects where a little extra effort can lift your average."}</p></div></div>
              </Card>
            </div>
            <Card style={{marginTop:12}}><div className="dasig-panel-title">📅 One Source, One Story</div>
              <div className="dasig-source-flow"><span>🗓️ Calendar</span><i>→</i><span>📝 Daily Attendance</span><i>→</i><span>📄 SF2</span><i>→</i><span>📊 SF4</span><i>→</i><span>👤 Your Attendance</span></div>
              <p className="dasig-source-note">Your attendance view is calculated from the same school-day calendar and daily attendance records used for the official attendance reports.</p>
            </Card>
            <DasigJourney profile={profile} termAverages={termAverages} average={overallAvg}
              attendancePct={latestTermIndex>=0?getTermAttendance(latestTermIndex+1).pct:null}
              currentStatus={attendanceEngine.learnerStatus(termAverage,previousAverage).key}/>
            <div className="dasig-quote-grid">
              {DASIG_QUOTES.slice(0,6).map((q,i)=><div className="dasig-quote-tile" key={q}><span>{["🌱","💚","🌟","📚","🔥","🏆"][i]}</span><p>“{q}”</p></div>)}
            </div>
          </div>
        )}

        {tab==="profile"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>👤 Student Profile</div>
            <Card style={{marginBottom:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[["Full Name",studentNameText(profile.name)],["LRN",profile.lrn],
                  ["Grade Level","Grade "+profile.grade_level],["Section",section?.name||"—"],
                  ["Gender",profile.gender||"—"],["Birthday",profile.birthday||"—"],
                  ...(profile.tve_qualification?[["TVE Qualification",profile.tve_qualification]]:[]),
                  ...(profile.shs_track?[["Track",profile.shs_track]]:[]),
                 ].map(([k,v])=>(
                  <div key={k}>
                    <div style={{fontSize:11,color:T.textMuted}}>{k}</div>
                    <div style={{fontSize:13,fontWeight:600,color:T.text}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10}}>
                <div style={{fontSize:11,color:T.textMuted}}>Address</div>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>{profile.address||"—"}</div>
              </div>
            </Card>
            <Card style={{textAlign:"center",marginBottom:10}}>
              <div style={{fontSize:12,color:T.textMuted}}>General Average</div>
              <div style={{fontSize:42,fontWeight:900,color:T.green2}}>{overallAvg||"—"}</div>
              {overallAvg&&<Badge text={remark(overallAvg).r} color={remark(overallAvg).c}/>}
            </Card>
            <ChangePasswordCard notify={notify}/>
          </div>
        )}

        {tab==="grades"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>
              📊 Grades & Attendance — S.Y. 2026–2027
            </div>
            <div className="insight-grid">
              <Card className="insight-card" style={{display:"flex",alignItems:"center",gap:16}}>
                <ProgressRing value={overallAvg||0} label="Average"/>
                <div>
                  <div className="insight-kicker">ACADEMIC SNAPSHOT</div>
                  <div className="insight-value">{overallAvg||"—"}</div>
                  {overallAvg&&<Badge text={remark(overallAvg).r} color={remark(overallAvg).c}/>}
                  <div className="insight-note">Across your recorded subjects</div>
                </div>
              </Card>
              <Card className="insight-card">
                <div className="insight-kicker">TERM PERFORMANCE</div>
                <TrendChart
                  values={[1,2,3].map(t=>avg(subjects.filter(s=>!s.parent_subject_id).map(s=>getG(s.id,t)).filter(Boolean))||0)}
                  labels={["Term 1","Term 2","Term 3"]}
                />
              </Card>
            </div>
            <Card style={{padding:0,overflow:"hidden",marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:T.green1}}>
                    <th style={{padding:"10px 8px",textAlign:"left",color:T.yellow}}>Subject</th>
                    <th style={{padding:"10px 6px",textAlign:"center",color:T.white}}>T1</th>
                    <th style={{padding:"10px 6px",textAlign:"center",color:T.white}}>T2</th>
                    <th style={{padding:"10px 6px",textAlign:"center",color:T.white}}>T3</th>
                    <th style={{padding:"10px 6px",textAlign:"center",color:T.yellow}}>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.length===0&&(
                    <tr><td colSpan={5} style={{textAlign:"center",padding:20,color:T.gray}}>
                      No subjects found.
                    </td></tr>
                  )}
                  {subjects.filter(s=>!s.parent_subject_id).flatMap((s,i)=>{
                    const fin=getFinal(s.id);
                    const {r:rem,c}=remark(fin);
                    const teacher=teachers.find(t=>t.id===s.teacher_id);
                    const comps=mapehComponentsOf(s,subjects);
                    const rows=[(
                      <tr key={s.id} style={{background:i%2===0?T.bgCard:"#f8fafc",
                        borderBottom:comps.length?"none":"1px solid #E3EEDD"}}>
                        <td style={{padding:"8px"}}>
                          <div style={{fontWeight:600,color:T.text}}>
                            {s.name}
                            {s.tve_qualification&&(
                              <span style={{fontWeight:400,color:T.textMuted}}> ({s.tve_qualification})</span>
                            )}
                          </div>
                          <div style={{fontSize:10,color:T.textMuted}}>
                            {comps.length?"Average of components below":(teacher?.name||"Unassigned")}
                          </div>
                        </td>
                        {[1,2,3].map(t=>{
                          const g=getG(s.id,t);
                          return <td key={t} style={{textAlign:"center",padding:"8px 4px",
                            color:g?remark(g).c:T.gray,fontWeight:g?700:400}}>{g||"—"}</td>;
                        })}
                        <td style={{textAlign:"center",padding:"8px 4px"}}>
                          <div style={{fontWeight:900,color:c,fontSize:14}}>{fin||"—"}</div>
                          <div style={{fontSize:9,color:c}}>{fin?rem:""}</div>
                        </td>
                      </tr>
                    )];
                    comps.forEach(c=>{
                      const cFin=getFinal(c.id);
                      const cTeacher=teachers.find(t=>t.id===c.teacher_id);
                      rows.push(
                        <tr key={c.id} style={{background:i%2===0?T.bgCard:"#f8fafc",
                          borderBottom:"1px solid #E3EEDD"}}>
                          <td style={{padding:"4px 8px 8px 24px"}}>
                            <div style={{fontSize:12,fontStyle:"italic",color:T.textMuted}}>{c.name}</div>
                            <div style={{fontSize:10,color:T.textMuted}}>{cTeacher?.name||"Unassigned"}</div>
                          </td>
                          {[1,2,3].map(t=>{
                            const g=getG(c.id,t);
                            return <td key={t} style={{textAlign:"center",padding:"4px 4px 8px",
                              fontSize:12,color:g?T.textMuted:T.gray}}>{g||"—"}</td>;
                          })}
                          <td style={{textAlign:"center",padding:"4px 4px 8px",fontSize:12,color:T.textMuted}}>
                            {cFin||"—"}
                          </td>
                        </tr>
                      );
                    });
                    return rows;
                  })}
                </tbody>
              </table>
            </Card>
            <div style={{fontSize:13,fontWeight:700,color:T.green1,marginBottom:8}}>
              📅 Attendance Summary
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {[1,2,3].map(term=>{
                const {totalDays,totalPresent,absent,pct}=getTermAttendance(term);
                return (
                  <Card key={term} style={{textAlign:"center",padding:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.green1,marginBottom:4}}>Term {term}</div>
                    <div style={{fontSize:22,fontWeight:900,color:attendColor(pct)}}>{pct}%</div>
                    <div style={{fontSize:10,color:T.textMuted}}>{totalPresent}/{totalDays} days</div>
                    <div style={{fontSize:10,color:T.red}}>{absent} absent</div>
                    <div style={{height:4,background:"#e0e0e0",borderRadius:2,marginTop:6}}>
                      <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
                        background:attendColor(pct),transition:"width .3s"}}/>
                    </div>
                  </Card>
                );
              })}
            </div>
            <div style={{fontSize:13,fontWeight:700,color:T.green1,marginBottom:8}}>
              📆 Monthly Attendance
            </div>
            <Card style={{padding:0,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:T.green2}}>
                    <th style={{padding:"8px",textAlign:"left",color:T.white}}>Month</th>
                    <th style={{padding:"8px",textAlign:"center",color:T.white}}>Days</th>
                    <th style={{padding:"8px",textAlign:"center",color:T.white}}>Present</th>
                    <th style={{padding:"8px",textAlign:"center",color:T.white}}>Absent</th>
                    <th style={{padding:"8px",textAlign:"center",color:T.yellow}}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {TERM_MONTHS.map((m,i)=>{
                    const {totalDays:sd,totalPresent:dp,absent:ab,pct,encoded}=getMonthlyAttendance(m);
                    return (
                      <tr key={i} style={{background:i%2===0?T.bgCard:"#f8fafc",
                        borderBottom:"1px solid #E3EEDD"}}>
                        <td style={{padding:"6px 8px"}}>
                          <div style={{fontWeight:600,color:T.text}}>{m.label}</div>
                          <div style={{fontSize:9,color:T.textMuted}}>Term {m.term}</div>
                        </td>
                        <td style={{textAlign:"center",color:T.text}}>{sd||"—"}</td>
                        <td style={{textAlign:"center",color:T.green2,fontWeight:700}}>{sd?(encoded?dp:"—"):"—"}</td>
                        <td style={{textAlign:"center",color:ab>0?T.red:T.gray}}>{sd?(encoded?ab:"—"):"—"}</td>
                        <td style={{textAlign:"center",fontWeight:700,
                          color:sd&&encoded?attendColor(pct):T.gray}}>{sd&&encoded?pct+"%":"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {tab==="appointment"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>
              📅 Book Appointment
            </div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>
                Request Parent-Teacher Conference
              </div>
              <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>
                Select Teacher
              </label>
              <select value={apptForm.teacherId} style={{marginBottom:10}}
                onChange={e=>setApptForm(p=>({...p,teacherId:e.target.value}))}>
                <option value="">-- Choose Teacher --</option>
                {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Date</label>
                  <input type="date" value={apptForm.date}
                    onChange={e=>setApptForm(p=>({...p,date:e.target.value}))}/>
                </div>
                <div>
                  <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Time</label>
                  <input type="time" value={apptForm.time}
                    onChange={e=>setApptForm(p=>({...p,time:e.target.value}))}/>
                </div>
              </div>
              <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>
                Reason / Purpose
              </label>
              <textarea rows={3} value={apptForm.reason} style={{marginBottom:12}}
                onChange={e=>setApptForm(p=>({...p,reason:e.target.value}))}
                placeholder="e.g. Discuss academic performance..."/>
              {apptMsg&&<div style={{fontSize:12,marginBottom:10,padding:"8px 12px",borderRadius:6,
                background:apptMsg.startsWith("✅")?"#EEF6EC":"#ffebee",
                color:apptMsg.startsWith("✅")?T.green2:T.red}}>{apptMsg}</div>}
              <Btn onClick={submitAppt} style={{width:"100%"}}>📩 Submit Request</Btn>
            </Card>
            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:8}}>
              My Appointments
            </div>
            {appointments.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No appointments yet.</div></Card>
              :appointments.map(a=>(
                <Card key={a.id} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontWeight:700,fontSize:13,color:T.text}}>{a.teacher_name}</div>
                    <Badge text={a.status}
                      color={a.status==="Pending"?T.yellow:a.status==="Approved"?T.green4:T.red}/>
                  </div>
                  <div style={{fontSize:12,color:T.textMuted}}>📅 {a.date} at {a.time}</div>
                  <div style={{fontSize:12,marginTop:4,color:T.text}}>{a.reason}</div>
                  {a.booked_by==="adviser"&&(
                    <div style={{fontSize:10,marginTop:4,color:T.green3,fontWeight:700}}>
                      🧑‍🏫 Scheduled by your adviser
                    </div>
                  )}
                </Card>
              ))
            }
          </div>
        )}
          </div>
        </div>
      </div>
      <BottomNav
        tabs={[["🌱","Dasig","dasig"],["👤","Profile","profile"],["📊","Grades","grades"],["📅","Appt","appointment"]]}
        active={tab} setActive={setTab}/>
      <Toast msg={toast}/>
    </div>
  );
};

// ─── SUBJECT GRADE REVIEW ───────────────────────────────────────────────
// Read-only review workspace available to every subject teacher. It uses the
// same subject_assignments scope as grade encoding, so teachers only review
// learners/classes assigned to them.
const SubjectGradeReview = ({profile, subjects, subjectAssignments, sections}) => {
  const availableSubjects=subjects.filter(s=>!isMapehParent(s,subjects));
  const [selSubject,setSelSubject]=useState(availableSubjects[0]?.id||"");
  const [selSection,setSelSection]=useState("");
  const [selTerm,setSelTerm]=useState(1);
  const [students,setStudents]=useState([]);
  const [grades,setGrades]=useState([]);
  const [loading,setLoading]=useState(false);

  const selectedSubject=availableSubjects.find(s=>s.id===selSubject);
  const assignments=subjectAssignments.filter(a=>a.subject_id===selSubject);
  const scopedIds=assignments.map(a=>a.section_id).filter(Boolean);
  const gradeWide=assignments.some(a=>!a.section_id);
  const sectionOptions=gradeWide
    ?sections.filter(sec=>sec.grade_level===selectedSubject?.grade_level)
    :sections.filter(sec=>scopedIds.includes(sec.id));

  useEffect(()=>{
    if (!selSubject && availableSubjects[0]?.id) setSelSubject(availableSubjects[0].id);
  },[availableSubjects.length]);

  useEffect(()=>{
    if (!selSubject) return;
    const firstScoped=scopedIds[0]||"";
    const valid=sectionOptions.some(sec=>sec.id===selSection);
    if (!valid) setSelSection(firstScoped||sectionOptions[0]?.id||"");
  },[selSubject,subjectAssignments.length,sections.length]);

  useEffect(()=>{
    if (!selectedSubject || !selSection) { setStudents([]); setGrades([]); return; }
    (async()=>{
      setLoading(true);
      let q=supabase.from("profiles").select("*")
        .eq("role","student").eq("grade_level",selectedSubject.grade_level).eq("section_id",selSection);
      if (selectedSubject.tve_qualification) q=q.eq("tve_qualification",selectedSubject.tve_qualification);
      const [stuR,gR]=await Promise.all([
        q.order("name"),
        supabase.from("grades").select("*").eq("subject_id",selSubject).eq("term",selTerm)
      ]);
      if (stuR.data) setStudents(sortStudentsMaleFirst(stuR.data));
      if (gR.data) setGrades(gR.data);
      setLoading(false);
    })();
  },[selSubject,selSection,selTerm,selectedSubject?.grade_level,selectedSubject?.tve_qualification]);

  const values=students.map(st=>grades.find(g=>g.student_id===st.id)?.grade).filter(v=>v!=null);
  const mean=values.length?Math.round(values.reduce((a,b)=>a+Number(b),0)/values.length*100)/100:null;
  const passed=values.filter(v=>Number(v)>=75).length;
  const missing=students.filter(st=>!grades.some(g=>g.student_id===st.id));

  return <div>
    <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:4}}>🔎 Review My Encoded Grades</div>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>Review your encoded grades by subject, section, and term. This is read-only and does not change official records.</div>
    <Card style={{marginBottom:12}}>
      <div className="teacher-review-controls">
        <div><label style={{fontSize:11,color:T.textMuted}}>Subject</label><select value={selSubject} onChange={e=>setSelSubject(e.target.value)}>
          <option value="">-- Select Subject --</option>{availableSubjects.map(sub=><option key={sub.id} value={sub.id}>{sub.name} · Gr.{sub.grade_level}</option>)}
        </select></div>
        <div><label style={{fontSize:11,color:T.textMuted}}>Section</label><select value={selSection} onChange={e=>setSelSection(e.target.value)} disabled={!selectedSubject}>
          <option value="">-- Select Section --</option>{sectionOptions.map(sec=><option key={sec.id} value={sec.id}>{sec.name}</option>)}
        </select></div>
        <div><label style={{fontSize:11,color:T.textMuted}}>Term</label><select value={selTerm} onChange={e=>setSelTerm(parseInt(e.target.value))}>
          <option value={1}>Term 1</option><option value={2}>Term 2</option><option value={3}>Term 3</option>
        </select></div>
      </div>
    </Card>
    {!selectedSubject||!selSection ? <Card><div style={{textAlign:"center",color:T.gray,padding:20}}>Select a subject and section to review encoded grades.</div></Card> : loading ? <Card><div style={{textAlign:"center",padding:20}}>⏳ Loading grades…</div></Card> : <>
      <div className="teacher-monitor-grid" style={{marginBottom:12}}>
        {[['👥',students.length,'Learners'],['📝',grades.filter(g=>students.some(s=>s.id===g.student_id)).length,'Encoded'],['📊',mean??'—','Average'],['⚠️',missing.length,'Missing']].map((x,i)=><Card key={i} style={{padding:12,textAlign:"center"}}><div style={{fontSize:18}}>{x[0]}</div><strong style={{fontSize:18,color:i===3&&x[1]>0?T.red:T.green2}}>{x[1]}</strong><div style={{fontSize:10,color:T.textMuted}}>{x[2]}</div></Card>)}
      </div>
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:700,color:T.green2}}>{selectedSubject.name} · {sections.find(s=>s.id===selSection)?.name} · Term {selTerm}</div>
          <Badge text={`${passed}/${values.length} passing`} color={passed===values.length?T.green3:T.yellow}/>
        </div>
        {students.filter(s=>s.gender==="Male").length>0&&<div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:T.blue,background:"#e3f2fd",padding:"5px 9px",borderRadius:6,marginBottom:4}}>♂ MALE ({students.filter(s=>s.gender==="Male").length})</div>
          {students.filter(s=>s.gender==="Male").map(st=><div key={st.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 8px",borderBottom:"1px solid #edf2ed"}}><span>{studentDisplay(st)}</span><strong style={{color:(grades.find(g=>g.student_id===st.id)?.grade??0)>=75?T.green3:T.red}}>{grades.find(g=>g.student_id===st.id)?.grade??"—"}</strong></div>)}
        </div>}
        {students.filter(s=>s.gender==="Female").length>0&&<div>
          <div style={{fontSize:11,fontWeight:800,color:"#c2185b",background:"#fce4ec",padding:"5px 9px",borderRadius:6,marginBottom:4}}>♀ FEMALE ({students.filter(s=>s.gender==="Female").length})</div>
          {students.filter(s=>s.gender==="Female").map(st=><div key={st.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 8px",borderBottom:"1px solid #edf2ed"}}><span>{studentDisplay(st)}</span><strong style={{color:(grades.find(g=>g.student_id===st.id)?.grade??0)>=75?T.green3:T.red}}>{grades.find(g=>g.student_id===st.id)?.grade??"—"}</strong></div>)}
        </div>}
      </Card>
    </>}
  </div>;
};

// ─── TEACHER / ADVISER / CURRICULUM HEAD ANALYTICS ─────────────────────
const TeacherAnalytics = ({profile, subjects, subjectAssignments, sections, mySection, classStudents}) => {
  const [term,setTerm]=useState(1);
  const [selSubject,setSelSubject]=useState("");
  const [selSection,setSelSection]=useState("");
  const [students,setStudents]=useState([]);
  const [grades,setGrades]=useState([]);
  const [loading,setLoading]=useState(false);

  const isCH=!!profile.is_curriculum_head;
  const isAdviser=!!mySection;
  const availableSubjects=subjects.filter(s=>!isMapehParent(s,subjects));

  // Build the subject list from the teacher's real assignments first, then
  // layer on the adviser/Curriculum-Head grade-wide visibility. These used to
  // be exclusive (isCH ? ... : isAdviser ? ... : assignments-only), which
  // meant an adviser or CH with a genuine subject_assignments row outside
  // their homeroom/assigned grade level would see it vanish entirely — the
  // grade-level branch overrode the real assignment instead of adding to it.
  const assignedSubjectIds=[...new Set(subjectAssignments.map(a=>a.subject_id).filter(Boolean))];
  const teacherSubjects=availableSubjects.filter(s=>
    assignedSubjectIds.includes(s.id)
    || (isCH&&s.grade_level===profile.assigned_grade_level)
    || (isAdviser&&s.grade_level===mySection?.grade_level));

  const selectedSubject=teacherSubjects.find(s=>s.id===selSubject);
  const assignments=selectedSubject
    ? subjectAssignments.filter(a=>a.subject_id===selectedSubject.id)
    : [];
  const assignedSectionIds=[...new Set(assignments.map(a=>a.section_id).filter(Boolean))];
  const gradeWide=assignments.some(a=>!a.section_id);
  const sectionOptions=isCH
    ? sections.filter(s=>s.grade_level===profile.assigned_grade_level)
    : isAdviser
      ? sections.filter(s=>s.id===mySection?.id)
      : gradeWide
        ? sections.filter(s=>s.grade_level===selectedSubject?.grade_level)
        : sections.filter(s=>assignedSectionIds.includes(s.id));

  useEffect(()=>{
    if(!selSubject || !teacherSubjects.some(s=>s.id===selSubject)) {
      setSelSubject(teacherSubjects[0]?.id||"");
      setSelSection("");
    }
  },[teacherSubjects.map(s=>s.id).join(','),mySection?.id,profile.assigned_grade_level]);

  useEffect(()=>{
    if(!selectedSubject) { setSelSection(""); return; }
    const valid=sectionOptions.some(s=>s.id===selSection);
    if(!valid) setSelSection(isAdviser?mySection?.id:(assignedSectionIds[0]||sectionOptions[0]?.id||""));
  },[selSubject,sectionOptions.map(s=>s.id).join(','),mySection?.id]);

  useEffect(()=>{
    if(!selectedSubject) { setStudents([]); setGrades([]); return; }
    (async()=>{
      setLoading(true);
      let scopedStudents=[];
      if(isAdviser && classStudents?.length) {
        scopedStudents=classStudents;
      } else {
        let q=supabase.from("profiles").select("*").eq("role","student").eq("grade_level",selectedSubject.grade_level);
        if(selSection) q=q.eq("section_id",selSection);
        else if(!isCH && assignedSectionIds.length && !gradeWide) q=q.in("section_id",assignedSectionIds);
        const {data}=await q.order("name");
        scopedStudents=data||[];
      }
      if(selectedSubject.tve_qualification) scopedStudents=scopedStudents.filter(st=>st.tve_qualification===selectedSubject.tve_qualification);
      const studentIds=scopedStudents.map(s=>s.id);
      let g=[];
      if(studentIds.length){
        const {data}=await supabase.from("grades").select("*").in("student_id",studentIds).eq("subject_id",selectedSubject.id);
        g=data||[];
      }
      setStudents(sortStudentsMaleFirst(scopedStudents));
      setGrades(g);
      setLoading(false);
    })();
  },[selectedSubject?.id,selectedSubject?.grade_level,selectedSubject?.tve_qualification,selSection,term,isAdviser,classStudents?.length,assignedSectionIds.join(','),gradeWide]);

  const gradeValue=(st)=>{
    if(term==="final"){
      const vals=[1,2,3].map(t=>grades.find(g=>g.student_id===st.id&&g.term===t)?.grade).filter(v=>v!=null).map(Number);
      return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
    }
    return grades.find(g=>g.student_id===st.id&&g.term===term)?.grade??null;
  };

  const values=students.map(gradeValue).filter(v=>v!=null).map(Number);
  const mean=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;
  const passing=values.filter(v=>v>=75).length;
  const missing=students.filter(st=>gradeValue(st)==null);
  const bands=[
    {label:"Advanced (90–100)",value:values.filter(v=>v>=90).length},
    {label:"Proficient (85–89)",value:values.filter(v=>v>=85&&v<90).length},
    {label:"Approaching (80–84)",value:values.filter(v=>v>=80&&v<85).length},
    {label:"Developing (75–79)",value:values.filter(v=>v>=75&&v<80).length},
    {label:"Beginning (<75)",value:values.filter(v=>v<75).length}
  ];
  const sd=values.length>1?Math.sqrt(values.reduce((sum,v)=>sum+Math.pow(v-mean,2),0)/(values.length-1)):null;
  const cv=sd!=null&&mean?Math.round(sd/mean*10000)/100:null;
  const scopeLabel=isCH?`Curriculum Head · Grade ${profile.assigned_grade_level}`:isAdviser?`Adviser · ${mySection.name}`:"Subject Teacher · My Assignments";

  return <div>
    <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>📊 My Teaching Analytics</div>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>{scopeLabel}. Select a subject and section below to view its complete analytics.</div>

    <Card style={{marginBottom:12}}>
      <div className="teacher-review-controls">
        <div><label style={{fontSize:11,color:T.textMuted}}>Subject</label><select value={selSubject} onChange={e=>{setSelSubject(e.target.value);setSelSection("")}}>
          <option value="">-- Select Subject --</option>{teacherSubjects.map(sub=><option key={sub.id} value={sub.id}>{sub.name} · Gr.{sub.grade_level}</option>)}
        </select></div>
        <div><label style={{fontSize:11,color:T.textMuted}}>Section</label><select value={selSection} onChange={e=>setSelSection(e.target.value)} disabled={!selectedSubject}>
          <option value="">-- Select Section --</option>{sectionOptions.map(sec=><option key={sec.id} value={sec.id}>{sec.name}</option>)}
        </select></div>
        <div><label style={{fontSize:11,color:T.textMuted}}>Term</label><select value={term} onChange={e=>setTerm(e.target.value==="final"?"final":parseInt(e.target.value))}>
          <option value={1}>Term 1</option><option value={2}>Term 2</option><option value={3}>Term 3</option><option value="final">Final / Year-End</option>
        </select></div>
      </div>
      {teacherSubjects.length===0&&<div style={{fontSize:11,color:T.red,marginTop:8}}>No subject assignments were found for this account. Check the teacher's subject assignments in the admin panel.</div>}
    </Card>

    {!selectedSubject||!selSection ? <Card><div style={{textAlign:"center",color:T.gray,padding:20}}>Select a subject and section to view analytics.</div></Card> : loading ? <Card><div style={{textAlign:"center",padding:24}}>⏳ Loading {selectedSubject.name} analytics…</div></Card> : <>
      <Card style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}>
          <div><strong style={{fontSize:14,color:T.green2}}>{selectedSubject.name}</strong><div style={{fontSize:10,color:T.textMuted}}>{sections.find(s=>s.id===selSection)?.name} · {term==="final"?"Final / Year-End":`Term ${term}`}</div></div>
          <Badge text={`${passing}/${values.length} passing`} color={passing===values.length?T.green3:T.yellow}/>
        </div>
        <div className="teacher-monitor-grid">
          {[['👥',students.length,'Learners'],['📝',values.length,'Encoded'],['📊',mean??'—','GSA / Average'],['⚠️',missing.length,'Missing']].map((x,i)=><Card key={i} style={{padding:12,textAlign:"center"}}><div style={{fontSize:18}}>{x[0]}</div><strong style={{fontSize:18,color:i===3&&x[1]>0?T.red:T.green2}}>{x[1]}</strong><div style={{fontSize:10,color:T.textMuted}}>{x[2]}</div></Card>)}
        </div>
      </Card>

      <div className="teacher-analytics-columns" style={{marginBottom:12}}>
        <Card><div style={{fontSize:13,fontWeight:800,color:T.green2,marginBottom:8}}>📈 Proficiency Distribution</div>{bands.map(b=><div key={b.label} style={{display:"grid",gridTemplateColumns:"130px 1fr auto",gap:8,alignItems:"center",marginBottom:8}}><span style={{fontSize:10}}>{b.label}</span><div style={{height:8,borderRadius:6,background:"#E3EEDD",overflow:"hidden"}}><div style={{height:"100%",width:`${values.length?Math.round(b.value/values.length*100):0}%`,background:T.green3}}/></div><strong style={{fontSize:10}}>{b.value}</strong></div>)}</Card>
        <Card><div style={{fontSize:13,fontWeight:800,color:T.green2,marginBottom:8}}>📐 Statistical Indicators</div>{[['Mean / GSA',mean??'—'],['Passing rate',values.length?`${Math.round(passing/values.length*100)}%`:'—'],['Standard deviation',sd!=null?Math.round(sd*100)/100:'—'],['Coefficient of variation',cv!=null?`${cv}%`:'—']].map((x,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #edf2ed"}}><span style={{fontSize:11,color:T.textMuted}}>{x[0]}</span><strong>{x[1]}</strong></div>)}</Card>
      </div>

      <Card style={{marginBottom:12}}><div style={{fontSize:13,fontWeight:800,color:T.green2,marginBottom:8}}>👥 Learners by Performance</div>{students.length===0?<div style={{color:T.gray,padding:12,textAlign:"center"}}>No learners found for this section.</div>:students.map(st=>{const v=gradeValue(st);return <div key={st.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 8px",borderBottom:"1px solid #edf2ed",fontSize:11}}><span>{studentDisplay(st)}</span><strong style={{color:v==null?T.gray:Number(v)<75?T.red:T.green3}}>{v==null?"—":Math.round(Number(v)*100)/100}</strong></div>})}</Card>

      <Card><div style={{fontSize:13,fontWeight:800,color:T.green2,marginBottom:8}}>💡 Interpretation</div><div style={{fontSize:11,color:T.textMuted,lineHeight:1.7}}>{mean==null?"No encoded grades are available for this selection yet.":`The selected subject has a GSA of ${mean}. ${passing} of ${values.length} recorded grades are at or above 75. ${missing.length?`${missing.length} learner${missing.length===1?' is':'s are'} still missing a grade.`:"All learners in the selected scope have a recorded grade."}`}</div></Card>
    </>}
  </div>;
};

// ─── TEACHER DAILY COMPANION ─────────────────────────────────────────────
// A lightweight floating coach for teachers. It surfaces concrete unfinished
// work for today without changing any official records.
const TeacherFieldBuddy = ({profile, subjects, subjectAssignments, sections, mySection, classStudents, appointments, onNavigate}) => {
  const [open,setOpen]=useState(true);
  const [todayAttendance,setTodayAttendance]=useState([]);
  const [todayGrades,setTodayGrades]=useState([]);
  const [scopeStudents,setScopeStudents]=useState([]);
  const today=new Date();
  const iso=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const term = iso < '2026-09-16' ? 1 : iso < '2027-01-04' ? 2 : 3;

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      if(mySection?.id && classStudents.length){
        const {data}=await supabase.from('daily_attendance').select('student_id,date,status')
          .eq('date',iso).in('student_id',classStudents.map(s=>s.id));
        if(!cancelled) setTodayAttendance(data||[]);
      } else if(!cancelled) setTodayAttendance([]);
      const ids=[...new Set(subjectAssignments.map(a=>a.subject_id).filter(Boolean))];
      const gradeLevels=[...new Set(subjects.filter(s=>ids.includes(s.id)).map(s=>s.grade_level).filter(Boolean))];
      if(gradeLevels.length){
        const {data}=await supabase.from('profiles').select('*').eq('role','student').in('grade_level',gradeLevels);
        if(!cancelled) setScopeStudents(data||[]);
      } else if(!cancelled) setScopeStudents([]);
      if(ids.length){
        const {data}=await supabase.from('grades').select('student_id,subject_id,term,grade').in('subject_id',ids).eq('term',term);
        if(!cancelled) setTodayGrades(data||[]);
      } else if(!cancelled) setTodayGrades([]);
    })();
    return ()=>{cancelled=true};
  },[iso,term,mySection?.id,classStudents.length,subjectAssignments.map(a=>a.subject_id).join(','),subjects.map(s=>s.id).join(',')]);

  const isWeekday=today.getDay()>0&&today.getDay()<6;
  const missingAttendance=mySection&&isWeekday ? Math.max(0,classStudents.length-todayAttendance.length) : 0;
  const assignmentRows=subjects.filter(sub=>{
    if(sub.parent_subject_id) return false;
    const as=subjectAssignments.filter(a=>a.subject_id===sub.id);
    return as.length>0;
  });
  const missingGrades=assignmentRows.reduce((n,sub)=>{
    let eligible=(mySection?classStudents:scopeStudents).filter(st=>st.grade_level===sub.grade_level && (!sub.tve_qualification||st.tve_qualification===sub.tve_qualification));
    const as=subjectAssignments.filter(a=>a.subject_id===sub.id);
    const secIds=as.map(a=>a.section_id).filter(Boolean);
    const gradeWide=as.some(a=>!a.section_id);
    if(mySection && secIds.length && !gradeWide) eligible=eligible.filter(st=>secIds.includes(st.section_id));
    if(!eligible.length) return n;
    return n+eligible.filter(st=>!todayGrades.some(g=>g.student_id===st.id&&g.subject_id===sub.id)).length;
  },0);
  const todaysAppointments=appointments.filter(a=>a.date===iso&&a.status!=='Declined').length;

  const items=[];
  if(missingAttendance>0) items.push({icon:'📆',text:`Attendance still needs checking for ${missingAttendance} learner${missingAttendance===1?'':'s'}.`,action:'Open Attendance',tab:'attendance'});
  if(missingGrades>0) items.push({icon:'📝',text:`${missingGrades} expected grade entr${missingGrades===1?'y':'ies'} are still missing in your current scope.`,action:'Review Grades',tab:'review'});
  if(todaysAppointments>0) items.push({icon:'🤝',text:`You have ${todaysAppointments} parent/teacher appointment${todaysAppointments===1?'':'s'} today.`,action:'View Appts',tab:'appointments'});
  if(!items.length) items.push({icon:'🌱',text:'Your teaching garden is clear today. Keep the good work growing!',action:'Open Analytics',tab:'analytics'});

  const messages=['Small progress is still progress.','One checked record today saves time tomorrow.','You are not behind—you are planting the next step.','Your learners feel the consistency you build.'];
  const message=messages[today.getDate()%messages.length];

  return <div className={`teacher-field-buddy ${open?'is-open':''}`}>
    <button className="teacher-field-buddy-toggle" onClick={()=>setOpen(v=>!v)} aria-label={open?'Minimize teacher buddy':'Open teacher buddy'}>
      <span className="teacher-buddy-sprout">🐦</span><span className="teacher-buddy-pulse"/>
    </button>
    {open&&<div className="teacher-field-buddy-card">
      <div className="teacher-buddy-art" aria-hidden="true"><div className="teacher-buddy-bird">🐦</div><span>🌾</span><span>✦</span></div>
      <div className="teacher-buddy-copy">
        <div className="teacher-buddy-kicker">MUNI · YOUR FIELD GUIDE</div>
        <strong>{profile?.name?.split(',')[0]||'Teacher'}, today’s little check-in:</strong>
        <p>{items[0].text}</p>
        <div className="teacher-buddy-message">“{message}”</div>
        <div className="teacher-buddy-actions">
          <button onClick={()=>onNavigate?.(items[0].tab)}>{items[0].action}</button>
          {items.length>1&&<span>+{items.length-1} more</span>}
        </div>
      </div>
    </div>}
  </div>;
};

// ─── ADMIN SCHOOL STATISTICS ─────────────────────────────────────────────
const proficiencyBand = value => {
  const v=Number(value);
  if(!Number.isFinite(v)) return null;
  if(v>=90) return 'Advanced';
  if(v>=85) return 'Proficient';
  if(v>=80) return 'Approaching Proficiency';
  if(v>=75) return 'Developing';
  return 'Beginning';
};
const meanOf = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const medianOf = values => {
  if(!values.length) return null;
  const a=[...values].sort((x,y)=>x-y), m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
const sdOf = values => {
  if(values.length<2) return 0;
  const m=meanOf(values); return Math.sqrt(values.reduce((s,v)=>s+(v-m)**2,0)/(values.length-1));
};
const round2 = v => v==null ? null : Math.round(v*100)/100;

const AdminSchoolStatistics = ({students,teachers,subjects,subjectAssignments,grades,sections}) => {
  const [term,setTerm]=useState(1);
  const [gradeFilter,setGradeFilter]=useState('all');
  const [teacherFilter,setTeacherFilter]=useState('all');
  const [subjectFilter,setSubjectFilter]=useState('all');
  const [view,setView]=useState('school');

  const scopedStudents=students.filter(s=>gradeFilter==='all'||String(s.grade_level)===String(gradeFilter));
  const scopeIds=new Set(scopedStudents.map(s=>s.id));
  const topSubjects=subjects.filter(s=>s.grade_level && !s.parent_subject_id && (gradeFilter==='all'||String(s.grade_level)===String(gradeFilter)));
  const applicable=(sub,st)=>{
    if(!sub||sub.parent_subject_id||String(sub.grade_level)!==String(st.grade_level)) return false;
    if(sub.section_id && sub.section_id!==st.section_id) return false;
    if(sub.tve_qualification && sub.tve_qualification!==st.tve_qualification) return false;
    return true;
  };
  const subjectGrade=(st,sub)=>gradeForTerm(sub,term,subjects,grades.filter(g=>g.student_id===st.id));
  const studentGsa=scopedStudents.map(st=>{
    const vals=topSubjects.filter(sub=>applicable(sub,st)).map(sub=>subjectGrade(st,sub)).filter(v=>v!=null).map(Number);
    return {student:st,values:vals,gsa:round2(meanOf(vals))};
  }).filter(r=>r.gsa!=null);
  const schoolVals=studentGsa.map(r=>r.gsa);
  const schoolGsa=round2(meanOf(schoolVals));
  const schoolMedian=round2(medianOf(schoolVals));
  const schoolSd=round2(sdOf(schoolVals));
  const se=schoolVals.length>1?schoolSd/Math.sqrt(schoolVals.length):0;
  const ci95=schoolGsa==null?null:[round2(schoolGsa-1.96*se),round2(schoolGsa+1.96*se)];
  const cv=schoolGsa?round2((schoolSd/schoolGsa)*100):null;
  const bands=['Advanced','Proficient','Approaching Proficiency','Developing','Beginning'].map(label=>({label,value:schoolVals.filter(v=>proficiencyBand(v)===label).length}));

  const rows=topSubjects.map(sub=>{
    const assigned=subjectAssignments.filter(a=>a.subject_id===sub.id);
    const assignedTeacherIds=[...new Set(assigned.map(a=>a.teacher_id).filter(Boolean))];
    const vals=scopedStudents.filter(st=>applicable(sub,st)).map(st=>subjectGrade(st,sub)).filter(v=>v!=null).map(Number);
    const counts=['Advanced','Proficient','Approaching Proficiency','Developing','Beginning'].map(label=>({label,value:vals.filter(v=>proficiencyBand(v)===label).length}));
    const names=assignedTeacherIds.map(id=>teachers.find(t=>t.id===id)?.name).filter(Boolean);
    return {sub,teachers:names,vals,mean:round2(meanOf(vals)),median:round2(medianOf(vals)),sd:round2(sdOf(vals)),pass:vals.length?round2(vals.filter(v=>v>=75).length/vals.length*100):0,counts,teacherIds:assignedTeacherIds};
  }).filter(r=>subjectFilter==='all'||r.sub.id===subjectFilter);

  const teacherRows=teachers.map(t=>{
    const assignedSubjectIds=[...new Set(subjectAssignments.filter(a=>a.teacher_id===t.id).map(a=>a.subject_id))];
    const rs=rows.filter(r=>r.teacherIds.includes(t.id) && assignedSubjectIds.includes(r.sub.id));
    const vals=rs.flatMap(r=>r.vals);
    return {teacher:t,rows:rs,mean:round2(meanOf(vals)),count:vals.length};
  }).filter(r=>r.rows.length && (teacherFilter==='all'||r.teacher.id===teacherFilter));

  const gradeRows=GRADE_LEVELS.map(gl=>{
    const vals=studentGsa.filter(r=>Number(r.student.grade_level)===gl).map(r=>r.gsa);
    return {label:`Grade ${gl}`,value:round2(meanOf(vals)),n:vals.length};
  }).filter(r=>r.n);
  const selectedRows=teacherFilter==='all' ? rows : rows.filter(r=>r.teacherIds.includes(teacherFilter));
  const filteredSchoolVals=teacherFilter==='all'&&subjectFilter==='all'?schoolVals:selectedRows.flatMap(r=>r.vals);
  const filteredGsa=round2(meanOf(filteredSchoolVals));
  const filteredBands=['Advanced','Proficient','Approaching Proficiency','Developing','Beginning'].map(label=>({label,value:filteredSchoolVals.filter(v=>proficiencyBand(v)===label).length}));
  const totalPossible=rows.reduce((n,r)=>n+r.vals.length,0);
  const passing=filteredSchoolVals.filter(v=>v>=75).length;
  const passingRate=filteredSchoolVals.length?round2(passing/filteredSchoolVals.length*100):null;
  const exportCSV=()=>{
    const header=['Subject','Teacher(s)','GSA/Mean','Median','SD','Pass %','Advanced','Proficient','Approaching Proficiency','Developing','Beginning'];
    const lines=[header,...rows.map(r=>[r.sub.name,r.teachers.join(' | '),r.mean??'',r.median??'',r.sd??'',r.pass,...r.counts.map(c=>c.value)])]
      .map(row=>row.map(v=>`"${String(v).replaceAll('\"','\"\"')}"`).join(','));
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`AGRIANS_GSA_Proficiency_Term${term}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return <div className="admin-statistics">
    <div className="admin-stat-head">
      <div><div className="insight-kicker">SCHOOL ACADEMIC INTELLIGENCE</div><h2>📊 GSA & Proficiency Observatory</h2><p>Consolidates grades from every teacher assignment into one school-level statistical view.</p></div>
      <div className="admin-stat-controls">
        <select value={term} onChange={e=>setTerm(parseInt(e.target.value))}><option value={1}>Term 1</option><option value={2}>Term 2</option><option value={3}>Term 3</option></select>
        <select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}><option value="all">All grades</option>{GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}</select>
        <select value={teacherFilter} onChange={e=>setTeacherFilter(e.target.value)}><option value="all">All teachers</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select value={subjectFilter} onChange={e=>setSubjectFilter(e.target.value)}><option value="all">All subjects</option>{topSubjects.map(s=><option key={s.id} value={s.id}>{s.name} · Gr.{s.grade_level}</option>)}</select><button className="admin-stat-export" onClick={exportCSV}>⬇ Export CSV</button>
      </div>
    </div>

    <div className="admin-stat-kpis">
      {[['🎯',filteredGsa??'—','GSA'],['👥',filteredSchoolVals.length,'GSA observations'],['✅',passingRate!=null?`${passingRate}%`:'—','Passing rate'],['📐',schoolSd??'—','Standard deviation'],['📍',ci95?`${ci95[0]}–${ci95[1]}`:'—','95% CI for GSA']].map((x,i)=><Card key={i} className="admin-stat-kpi"><span>{x[0]}</span><strong>{x[1]}</strong><small>{x[2]}</small></Card>)}
    </div>

    <div className="admin-stat-view-tabs">
      {[['school','🏫 School'],['teachers','👨‍🏫 Teachers'],['subjects','📚 Subjects'],['inference','🧪 Inferential']].map(([id,label])=><button key={id} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}
    </div>

    {view==='school'&&<>
      <div className="admin-stat-two-col">
        <Card><div className="stat-card-title">Overall school GSA</div><div className="stat-big-number">{schoolGsa??'—'}</div><div className="stat-muted">Term {term} · based on learner-level general averages</div><MiniBarChart data={bands} label="Learners by GSA proficiency band"/></Card>
        <Card><div className="stat-card-title">GSA by grade level</div>{gradeRows.length?gradeRows.map(r=><div className="stat-grade-row" key={r.label}><span>{r.label}</span><div className="stat-track"><i style={{width:`${Math.min(100,r.value||0)}%`}}/></div><strong>{r.value}</strong><small>n={r.n}</small></div>):<div className="stat-muted">No complete GSA observations yet.</div>}</Card>
      </div>
      <Card><div className="stat-card-title">School proficiency distribution</div><MiniBarChart data={filteredBands} label="GSA counts by proficiency level" height={170}/><div className="proficiency-legend">{filteredBands.map(b=><span key={b.label}><b>{b.value}</b> {b.label}</span>)}</div></Card>
    </>}

    {view==='teachers'&&<Card><div className="stat-card-title">Teacher contribution to academic performance</div><div className="admin-stat-table-wrap"><table className="admin-stat-table"><thead><tr><th>Teacher</th><th>Subjects</th><th>Observations</th><th>Mean grade</th></tr></thead><tbody>{teacherRows.sort((a,b)=>(b.mean??-1)-(a.mean??-1)).map(r=><tr key={r.teacher.id}><td>{r.teacher.name}</td><td>{r.rows.map(x=>x.sub.name).join(', ')}</td><td>{r.count}</td><td><strong>{r.mean??'—'}</strong></td></tr>)}</tbody></table></div></Card>}

    {view==='subjects'&&<Card><div className="stat-card-title">Every teacher subject · GSA · proficiency counts</div><div className="admin-stat-table-wrap"><table className="admin-stat-table"><thead><tr><th>Subject / Teacher</th><th>GSA</th><th>Pass %</th><th>Advanced</th><th>Proficient</th><th>Approaching</th><th>Developing</th><th>Beginning</th></tr></thead><tbody>{rows.sort((a,b)=>(b.mean??-1)-(a.mean??-1)).map(r=><tr key={r.sub.id}><td><strong>{r.sub.name}</strong><small>{r.teachers.length?r.teachers.join(' · '):'Unassigned'}</small></td><td><strong>{r.mean??'—'}</strong><small>Median {r.median??'—'} · SD {r.sd??'—'}</small></td><td>{r.pass}%</td>{r.counts.map(c=><td key={c.label}>{c.value}</td>)}</tr>)}</tbody></table></div></Card>}

    {view==='inference'&&<div className="admin-stat-two-col">
      <Card><div className="stat-card-title">Inferential statistics</div><div className="stat-method-row"><span>Mean</span><strong>{schoolGsa??'—'}</strong></div><div className="stat-method-row"><span>Median</span><strong>{schoolMedian??'—'}</strong></div><div className="stat-method-row"><span>SD</span><strong>{schoolSd??'—'}</strong></div><div className="stat-method-row"><span>Coefficient of variation</span><strong>{cv!=null?`${cv}%`:'—'}</strong></div><div className="stat-method-row"><span>95% confidence interval</span><strong>{ci95?`${ci95[0]} to ${ci95[1]}`:'—'}</strong></div></Card>
      <Card><div className="stat-card-title">Interpretation guide</div><ul className="stat-guide"><li><b>GSA</b> summarizes the learner-level average across applicable subjects.</li><li><b>SD</b> shows how spread out learner GSAs are around the school mean.</li><li><b>95% CI</b> estimates the range for the underlying mean when the observed learners are treated as a sample.</li><li><b>CV</b> expresses variation relative to the mean and helps compare consistency across terms.</li><li>Use the filters to compare grades, teachers, or subjects before making instructional decisions.</li></ul></Card>
    </div>}
    <div className="admin-stat-footnote">Proficiency bands used: Advanced 90–100 · Proficient 85–89 · Approaching Proficiency 80–84 · Developing 75–79 · Beginning below 75. MAPEH parent rows are resolved from their components and are not double-counted.</div>
  </div>;
};

// ─── TEACHER DASHBOARD ───────────────────────────────────
const TeacherDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("encode");
  const [subjects,setSubjects]=useState([]);
  const [subjectAssignments,setSubjectAssignments]=useState([]);
  const [students,setStudents]=useState([]);
  const [mySection,setMySection]=useState(null);
  const [classStudents,setClassStudents]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [selSubject,setSelSubject]=useState("");
  const [selTerm,setSelTerm]=useState(1);
  const [selSection,setSelSection]=useState("");
  const [localGrades,setLocalGrades]=useState({});
  const [dbGrades,setDbGrades]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [holidays,setHolidays]=useState([]);
  const [selAttMonth,setSelAttMonth]=useState(null);
  const [dailyAtt,setDailyAtt]=useState([]); // daily_attendance rows for the selected month
  const [localDaily,setLocalDaily]=useState({}); // pending toggles: `${studentId}|${date}` -> 'present'|'absent'
  const [savingAtt,setSavingAtt]=useState(false);
  const [sections,setSections]=useState([]);
  const [toast,setToast]=useState("");
  const [loading,setLoading]=useState(true);
  const [advApptForm,setAdvApptForm]=useState({studentId:"",date:"",time:"",reason:""});
  const [advApptMsg,setAdvApptMsg]=useState("");
  const [honorsThreshold,setHonorsThreshold]=useState(90);
  const [honorsScope,setHonorsScope]=useState("section"); // "section" | "grade"
  const [classGrades,setClassGrades]=useState([]); // all grades for students in scope
  const [gradeLevelStudents,setGradeLevelStudents]=useState([]); // whole grade level (for "grade" scope)
  const [allGradeSubjects,setAllGradeSubjects]=useState([]);
  const [summaryTerm,setSummaryTerm]=useState(1); // 1, 2, 3, or "final" — for My Class grade summary
  const [qualifications,setQualifications]=useState([]); // admin-managed TVE qualification names
  const [chStudents,setChStudents]=useState([]); // Curriculum Head: all students in their assigned grade level
  const [editStudent,setEditStudent]=useState(null); // Curriculum Head: learner being corrected
  const isAdviser=!!mySection;

  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),2500);};

  const fetchData=useCallback(async()=>{
    setLoading(true);
    const [sR,asR,aR,secR,qR,calR,holR]=await Promise.all([
      supabase.from("subjects").select("*").eq("teacher_id",profile.id),
      supabase.from("subject_assignments").select("id,subject_id,teacher_id,section_id").eq("teacher_id",profile.id),
      supabase.from("appointments").select("*").eq("teacher_id",profile.id),
      supabase.from("sections").select("*").eq("adviser_id",profile.id).order("name").limit(1),
      supabase.from("tve_qualifications").select("*").order("name"),
      supabase.from("school_calendar").select("*").order("year").order("month"),
      supabase.from("school_holidays").select("*").order("date"),
    ]);
    const assignmentRows=asR.data||[];
    if (assignmentRows.length) setSubjectAssignments(assignmentRows);
    // Resolve subjects independently by ID. This guarantees that every assignment
    // is represented even when PostgREST does not return the nested subject object.
    if (assignmentRows.length) {
      const assignedIds=[...new Set(assignmentRows.map(a=>a.subject_id).filter(Boolean))];
      let assignedSubjects=[];
      if (assignedIds.length) {
        const {data}=await supabase.from("subjects").select("*").in("id",assignedIds);
        assignedSubjects=data||[];
      }
      const unique=new Map(assignedSubjects.map(sub=>[sub.id,sub]));
      (sR.data||[]).forEach(sub=>{ if(!unique.has(sub.id)) unique.set(sub.id,sub); });
      setSubjects(Array.from(unique.values()));
    } else if (sR.data) setSubjects(sR.data);
    if (aR.data) setAppointments(aR.data);
    if (qR.data) setQualifications(qR.data.map(q=>q.name));
    if (calR.data) setCalendar(calR.data);
    if (holR.data) setHolidays(holR.data);
    const adviserSection=Array.isArray(secR.data)?(secR.data[0]||null):secR.data;
    if (adviserSection) {
      setMySection(adviserSection);
      const {data:stuData}=await supabase.from("profiles").select("*")
        .eq("role","student").eq("section_id",adviserSection.id).order("gender").order("name");
      if (stuData) setClassStudents(sortStudentsMaleFirst(stuData));
    }
    const {data:allSec}=await supabase.from("sections").select("*");
    if (allSec) setSections(allSec);
    setLoading(false);
  },[profile.id]);

  useEffect(()=>{fetchData();},[fetchData]);

  // Curriculum Head: load every student in their assigned grade level (all
  // sections), so they get a full per-section view — not just the ones
  // they personally added.
  const fetchChStudents=useCallback(async()=>{
    if (!profile.is_curriculum_head) return;
    const {data}=await supabase.from("profiles").select("*")
      .eq("role","student").eq("grade_level",profile.assigned_grade_level)
      .order("section_id").order("gender").order("name");
    if (data) setChStudents(sortStudentsMaleFirst(data));
  },[profile.is_curriculum_head,profile.assigned_grade_level]);

  useEffect(()=>{fetchChStudents();},[fetchChStudents]);

  const handleUpdateStudent=async updates=>{
    if (!editStudent) return;
    // CH can never change grade level — EditStudentModal never includes it
    // when canChangeGrade=false, so `updates` here is already safe to send as-is.
    const result=await edgeCall("update-student",{studentId:editStudent.id,updates});
    if (result.error){notify("❌ "+result.error);return;}
    notify("✅ Learner updated!");
    setEditStudent(null);
    fetchChStudents();
  };

  // Fetch data needed for the Honors tab and Grade Summary (My Class) —
  // both need class-wide grades, so share one fetch.
  useEffect(()=>{
    if ((tab!=="honors"&&tab!=="myclass")||!mySection) return;
    (async()=>{
      let studentsInScope=classStudents;
      if (tab==="honors"&&honorsScope==="grade") {
        const {data}=await supabase.from("profiles").select("*")
          .eq("role","student").eq("grade_level",mySection.grade_level).order("name");
        if (data) { setGradeLevelStudents(data); studentsInScope=data; }
      }
      const ids=studentsInScope.map(s=>s.id);
      if (ids.length===0) return;
      const [gR,subR]=await Promise.all([
        supabase.from("grades").select("*").in("student_id",ids),
        supabase.from("subjects").select("*").eq("grade_level",mySection.grade_level),
      ]);
      if (gR.data) setClassGrades(gR.data);
      if (subR.data) setAllGradeSubjects(subR.data);
    })();
  },[tab,mySection,honorsScope,classStudents]);

  // Adviser's class view refreshes when a subject teacher saves a grade.
  useEffect(()=>{
    if (!mySection || !isAdviser) return;
    const ch=supabase.channel(`adviser-grades-${mySection.id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"grades"},async()=>{
        if (tab!=="honors"&&tab!=="myclass") return;
        const scopeStudents=(tab==="honors"&&honorsScope==="grade")?gradeLevelStudents:classStudents;
        const ids=scopeStudents.map(s=>s.id);
        if (!ids.length) return;
        const {data}=await supabase.from("grades").select("*").in("student_id",ids);
        if (data) setClassGrades(data);
      }).subscribe();
    return ()=>supabase.removeChannel(ch);
  },[mySection?.id,isAdviser,tab,honorsScope,classStudents,gradeLevelStudents]);

  // Compute each student's per-term and final general average from classGrades.
  // MAPEH is never graded directly — it's split into two components ("PE and
  // Health" and "Music and Arts") linked via parent_subject_id. Must go
  // through gradeForTerm (like every other average calc in the app) so MAPEH
  // counts as ONE subject instead of double-counting its two components.
  const computeHonorsRoll=()=>{
    const studentsInScope=honorsScope==="grade"?gradeLevelStudents:classStudents;
    const countedSubjects=allGradeSubjects.filter(s=>
      !s.parent_subject_id
      && s.grade_level===mySection?.grade_level
      && (!s.section_id || honorsScope==="grade" || s.section_id===mySection?.id)
    );
    return studentsInScope.map(stu=>{
      const myGrades=classGrades.filter(g=>g.student_id===stu.id);
      const termAvgs=[1,2,3].map(term=>{
        const termGrades=countedSubjects
          .map(sub=>gradeForTerm(sub,term,allGradeSubjects,myGrades))
          .filter(v=>v!==null);
        if (termGrades.length===0) return null;
        return Math.round((termGrades.reduce((a,b)=>a+b,0)/termGrades.length)*100)/100;
      });
      const validTermAvgs=termAvgs.filter(a=>a!==null);
      const finalAvg=validTermAvgs.length>0
        ?Math.round((validTermAvgs.reduce((a,b)=>a+b,0)/validTermAvgs.length)*100)/100
        :null;
      return {student:stu,termAvgs,finalAvg};
    });
  };

  // Per-subject grade summary table for My Class — students × subjects for a given term
  // (or "final" = average across all 3 terms per subject).
  const computeGradeSummary=(term)=>{
    // MAPEH's components are encoded separately but shouldn't appear (or be
    // averaged into the class average) as their own columns here — only the
    // computed MAPEH column should, otherwise it would double-count.
    const mySubjects=allGradeSubjects.filter(sub=>
      (!sub.section_id||sub.section_id===mySection?.id) && !sub.parent_subject_id);
    return classStudents.map(stu=>{
      const myGrades=classGrades.filter(g=>g.student_id===stu.id);
      const bySubject={};
      mySubjects.forEach(sub=>{
        if (term==="final") {
          const vals=[1,2,3].map(t=>gradeForTerm(sub,t,allGradeSubjects,myGrades)).filter(v=>v!==null);
          bySubject[sub.id]=vals.length
            ?Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*100)/100
            :null;
        } else {
          bySubject[sub.id]=gradeForTerm(sub,term,allGradeSubjects,myGrades);
        }
      });
      const values=Object.values(bySubject).filter(v=>v!==null);
      const average=values.length>0
        ?Math.round((values.reduce((a,b)=>a+b,0)/values.length)*100)/100
        :null;
      return {student:stu,bySubject,average};
    });
  };

  useEffect(()=>{
    if (!selSubject) return;
    const sub=subjects.find(s=>s.id===selSubject);
    // If the previously-selected subject is term-scoped and doesn't run in
    // the term the teacher just switched to, drop the stale selection rather
    // than silently keeping it picked while it's hidden from the dropdown.
    if (sub&&sub.term&&sub.term!==selTerm) { setSelSubject(""); setSelSection(""); }
  },[selTerm]);

  useEffect(()=>{
    if (!selSubject||!selSection) { setStudents([]); return; }
    const sub=subjects.find(s=>s.id===selSubject);
    if (!sub) return;
    (async()=>{
      // Scope the roster to one section at a time (per-section encoding), and
      // if this subject is tagged with a TVE qualification, only show students
      // who are assigned that exact qualification within that section. For
      // Grade 11-12, a section can hold both Regular and ALS learners sharing
      // the same grade/section — an ALS subject must only ever pull ALS
      // students (and a Regular subject only Regular students), the same way
      // a TVE-qualification-tagged subject only pulls that one qualification.
      // A section can also mix tracks (Academic/TechPro, or TVL-AFA/TVL-HE) —
      // a track-scoped subject must only pull students on that same track.
      // profiles.shs_track stores the full label including any
      // sub-specialization ("TechPro - Bakery Operations"), while a
      // subject's own scope is the coarser tag ("TechPro"), so this matches
      // by prefix (case-insensitive) rather than exact equality.
      let stuQuery=supabase.from("profiles").select("*")
        .eq("role","student").eq("grade_level",sub.grade_level).eq("section_id",selSection);
      if (sub.tve_qualification) stuQuery=stuQuery.eq("tve_qualification",sub.tve_qualification);
      stuQuery=stuQuery.eq("curriculum",sub.curriculum||"regular");
      if (sub.shs_track) stuQuery=stuQuery.ilike("shs_track",`${sub.shs_track}%`);
      const [stuR,gR]=await Promise.all([
        stuQuery.order("name"),
        supabase.from("grades").select("*").eq("subject_id",selSubject).eq("term",selTerm),
      ]);
      if (stuR.data) setStudents(sortStudentsMaleFirst(stuR.data));
      if (gR.data) setDbGrades(gR.data);
    })();
  },[selSubject,selSection,selTerm,subjects]);

  const getGradeVal=studentId=>{
    const key=`${studentId}-${selSubject}-${selTerm}`;
    if (localGrades[key]!==undefined) return localGrades[key];
    return dbGrades.find(g=>g.student_id===studentId)?.grade||"";
  };

  const saveGrades=async()=>{
    const upserts=students
      .filter(s=>localGrades[`${s.id}-${selSubject}-${selTerm}`]!==undefined)
      .map(s=>({student_id:s.id,subject_id:selSubject,term:selTerm,
        grade:parseFloat(localGrades[`${s.id}-${selSubject}-${selTerm}`])||0,encoded_by:profile.id}));
    if (!upserts.length){notify("⚠️ No changes to save.");return;}
    const {error}=await supabase.from("grades").upsert(upserts,{onConflict:"student_id,subject_id,term"});
    if (error){notify("❌ "+error.message);return;}
    setLocalGrades({});
    notify("✅ Grades saved and synced!");
    const {data}=await supabase.from("grades").select("*").eq("subject_id",selSubject).eq("term",selTerm);
    if (data) setDbGrades(data);
  };

  // Load this section's daily attendance rows whenever the selected month changes.
  useEffect(()=>{
    if (!selAttMonth||!classStudents.length){setDailyAtt([]);return;}
    const days=schoolDaysInMonth(selAttMonth,holidays);
    if (!days.length){setDailyAtt([]);return;}
    const stuIds=classStudents.map(s=>s.id);
    (async()=>{
      const {data}=await supabase.from("daily_attendance").select("*")
        .in("student_id",stuIds).gte("date",days[0].date).lte("date",days[days.length-1].date);
      setDailyAtt(data||[]);
      setLocalDaily({});
    })();
  },[selAttMonth,classStudents,holidays]);

  const getDailyStatus=(studentId,date)=>{
    const key=`${studentId}|${date}`;
    if (localDaily[key]!==undefined) return localDaily[key];
    const row=dailyAtt.find(a=>a.student_id===studentId&&a.date===date);
    return row?row.status:"present"; // unmarked days default to present — click to flag an absence
  };

  const toggleDaily=(studentId,date)=>{
    const current=getDailyStatus(studentId,date);
    const next=current==="present"?"absent":"present";
    setLocalDaily(p=>({...p,[`${studentId}|${date}`]:next}));
  };

  const markAllPresent=date=>{
    setLocalDaily(p=>{
      const next={...p};
      classStudents.forEach(s=>{next[`${s.id}|${date}`]="present";});
      return next;
    });
  };

  const saveDailyAttendance=async()=>{
    if (!selAttMonth){notify("⚠️ Select a month first.");return;}
    const calendarSource=attendanceEngine.configuredDays(selAttMonth,calendar,holidays);
    const days=calendarSource.days;
    if (!days.length){notify("⚠️ No school days in this range (check holidays).");return;}
    if (!calendarSource.agreed){
      notify(`⚠️ Calendar mismatch: configured ${calendarSource.configured}, actual date grid ${calendarSource.actual}. Fix the calendar before saving attendance.`);
      return;
    }
    setSavingAtt(true);
    // Write the FULL grid (every student × every school day this month) so the
    // daily record always matches exactly what's shown on screen.
    const rows=[];
    classStudents.forEach(s=>{
      days.forEach(d=>{
        rows.push({student_id:s.id,date:d.date,status:getDailyStatus(s.id,d.date),encoded_by:profile.id});
      });
    });
    const {error}=await supabase.from("daily_attendance")
      .upsert(rows,{onConflict:"student_id,date"});
    if (error){notify("❌ "+error.message);setSavingAtt(false);return;}

    // Do not write a second monthly attendance total. The daily grid is now
    // the sole attendance record; monthly totals are derived from it. This
    // prevents stale rows (e.g. 21 present after the calendar is corrected to
    // 19 school days) from surviving in a legacy attendance table.
    setSavingAtt(false);
    notify("✅ Daily attendance saved!");
    fetchData();
  };

  const updateApptStatus=async(id,status)=>{
    const {error}=await supabase.from("appointments").update({status}).eq("id",id);
    if (error){notify("❌ "+error.message);return;}
    setAppointments(p=>p.map(a=>a.id===id?{...a,status}:a));
    notify(`✅ Appointment ${status}!`);
  };

  // Adviser books a parent-teacher conference on behalf of an advisory student.
  // Counts toward the same 3-appointments-per-day-per-teacher limit.
  const submitAdvAppt=async()=>{
    if (!advApptForm.studentId||!advApptForm.date||!advApptForm.time||!advApptForm.reason){
      setAdvApptMsg("❌ Please fill all fields."); return;
    }
    const {count,error:countErr}=await supabase.from("appointments")
      .select("id",{count:"exact",head:true})
      .eq("teacher_id",profile.id).eq("date",advApptForm.date)
      .in("status",["Pending","Approved"]);
    if (countErr){setAdvApptMsg("❌ "+countErr.message);return;}
    if ((count||0)>=3){
      setAdvApptMsg("❌ You already have 3 appointments booked on this date. Please choose another date.");
      return;
    }
    const student=classStudents.find(s=>s.id===advApptForm.studentId);
    const {error}=await supabase.from("appointments").insert({
      student_id:advApptForm.studentId,student_name:student?.name||"",
      teacher_id:profile.id,teacher_name:profile.name,
      date:advApptForm.date,time:advApptForm.time,reason:advApptForm.reason,
      status:"Approved",booked_by:"adviser",
    });
    if (error){setAdvApptMsg("❌ "+error.message);return;}
    setAdvApptMsg("✅ Conference scheduled!");
    setAdvApptForm({studentId:"",date:"",time:"",reason:""});
    fetchData(); setTimeout(()=>setAdvApptMsg(""),3000);
  };

  const [addingStudent,setAddingStudent]=useState(false);
  const handleAddStudent=async form=>{
    if (!form.name||!form.lrn||!form.email||!form.password){
      notify("❌ Name, LRN, email and password required."); return;
    }
    const gradeLevel=parseInt(profile.assigned_grade_level);
    if (gradeLevel>=8&&gradeLevel<=10&&!form.tve_qualification){
      notify("❌ TVE Qualification is required for Grades 8-10."); return;
    }
    if ((gradeLevel===11||gradeLevel===12)&&form.curriculum!=="als"&&!form.shs_track){
      notify("❌ Track is required for Grades 11-12."); return;
    }
    setAddingStudent(true);
    try {
      const result=await edgeCall("create-user",{
        role:"student",email:form.email,password:form.password,
        name:form.name,lrn:form.lrn,grade_level:gradeLevel,
        section_id:form.section_id||null,gender:form.gender,birthday:form.birthday||null,
        address:form.address,
        tve_qualification:(gradeLevel>=8&&gradeLevel<=10)?form.tve_qualification:null,
        shs_track:(gradeLevel===11||gradeLevel===12)?form.shs_track:null,
        curriculum:(gradeLevel===11||gradeLevel===12)?(form.curriculum||"regular"):"regular",
      });
      if (result.error){notify("❌ "+result.error);return;}
      notify("✅ Student added!");
      await new Promise(r=>setTimeout(r,400));
      await fetchData();
      await fetchChStudents();
    } catch (err) {
      notify("❌ "+(err.message||"Failed to add student."));
    } finally {
      setAddingStudent(false);
    }
  };

  const generateCertificate=async(student,periodLabel,average)=>{
    const day=prompt("Enter the day of the month for this certificate (e.g. 15):");
    if (!day) return;
    const month=prompt("Enter the month (e.g. December):");
    if (!month) return;

    // Certificate's TERM line: "Term 1" -> "TERM 1", "Final / Year-End" -> "FINAL AVERAGE"
    const termText=periodLabel.startsWith("Term")
      ?periodLabel.toUpperCase()
      :"FINAL AVERAGE";

    // getSession() can hand back a *stale* cached access token — e.g. after the
    // tab sat idle/backgrounded and missed its auto-refresh window — without
    // erroring, which is what caused 401s here even though a "session" existed.
    // Proactively refresh first, and if the server still says 401, refresh
    // once more and retry before giving up.
    const getFreshToken=async(forceRefresh)=>{
      if (forceRefresh) {
        const {data,error}=await supabase.auth.refreshSession();
        if (!error && data?.session?.access_token) return data.session.access_token;
      }
      const {data:sessionData}=await supabase.auth.getSession();
      return sessionData?.session?.access_token||null;
    };

    let token=await getFreshToken(true);
    if (!token) {
      notify("❌ Your session has expired. Please log in again.");
      return;
    }
    notify("⏳ Generating certificate...");
    try {
      const callGenerate=async(tkn)=>fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-certificate`,
        {method:"POST",
         headers:{"Content-Type":"application/json","apikey":import.meta.env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${tkn}`},
         body:JSON.stringify({
           student_id:student.id,period_label:termText,
           average,honor_title:"ACADEMIC EXCELLENCE AWARD",
           school_year:"2026-2027",day,month,
         })}
      );
      let res=await callGenerate(token);
      if (res.status===401) {
        // Token was rejected server-side even after a client-side refresh —
        // try one hard refresh + retry before surfacing an error.
        const retryToken=await getFreshToken(true);
        if (retryToken && retryToken!==token) res=await callGenerate(retryToken);
      }
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate certificate"}));
        if (res.status===401) {
          notify("❌ Your session has expired. Please log in again.");
        } else {
          notify("❌ "+(err.error||"Failed to generate certificate"));
        }
        return;
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`Certificate_${student.name.replace(/\s+/g,"_")}_${periodLabel.replace(/\s+/g,"_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify("✅ Certificate downloaded!");
    } catch (e) {
      notify("❌ "+String(e.message||e));
    }
  };

  const [sf9Term,setSf9Term]=useState("final"); // 1, 2, 3, or "final"
  const generateSF9=async student=>{
    if (!mySection) return;
    notify("⏳ Generating SF9...");
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData?.session?.access_token;
    const periodLabel=sf9Term==="final"?"Final / Year-End":`Term ${sf9Term}`;
    try {
      const res=await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sf9`,
        {method:"POST",
         headers:{"Content-Type":"application/json","apikey":import.meta.env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`},
         body:JSON.stringify({
           student_id:student.id,section_id:mySection.id,
           term:sf9Term,school_year:"2026-2027",
         })}
      );
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate SF9"}));
        notify("❌ "+(err.error||"Failed to generate SF9"));
        return;
      }
      const warningHeader=res.headers.get("X-Encoding-Warning");
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`SF9_${student.name.replace(/\s+/g,"_")}_${periodLabel.replace(/\s+/g,"_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (warningHeader) {
        setToast("⚠️ Downloaded, but "+decodeURIComponent(warningHeader));
        setTimeout(()=>setToast(""),8000);
      } else {
        notify("✅ SF9 downloaded!");
      }
    } catch (e) {
      notify("❌ "+String(e.message||e));
    }
  };

  const [sf2Month,setSf2Month]=useState(null);
  const generateSF2=async()=>{
    if (!mySection||!sf2Month) {notify("⚠️ Select a month first.");return;}
    notify("⏳ Generating SF2...");
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData?.session?.access_token;
    try {
      const res=await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sf2`,
        {method:"POST",
         headers:{"Content-Type":"application/json","apikey":import.meta.env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`},
         body:JSON.stringify({
           section_id:mySection.id, month:sf2Month.month, year:sf2Month.year, term:sf2Month.term,
         })}
      );
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate SF2"}));
        notify("❌ "+(err.error||"Failed to generate SF2"));
        return;
      }
      const warningHeader=res.headers.get("X-Encoding-Warning");
      const genderWarningHeader=res.headers.get("X-Gender-Data-Warning");
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`SF2_${mySection.name.replace(/\s+/g,"_")}_${sf2Month.label.replace(/\s+/g,"_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const warnings=[warningHeader,genderWarningHeader].filter(Boolean).map(decodeURIComponent);
      if (warnings.length) {
        setToast("⚠️ Downloaded, but "+warnings.join(" | "));
        setTimeout(()=>setToast(""),8000);
      } else {
        notify("✅ SF2 downloaded!");
      }
    } catch (e) {
      notify("❌ "+String(e.message||e));
    }
  };

  const tabs=[["✏️","Encode","encode"],["🔎","Review","review"],["📊","Analytics","analytics"],["📅","Appts","appointments"]];
  if (mySection) tabs.splice(1,0,["🏫","My Class","myclass"],["📆","Attendance","attendance"],
    ["🏆","Honors","honors"],["📄","Forms","reports"]);
  if (profile.is_curriculum_head) tabs.push(["🎓","Students","chstudents"]);

  if (loading) return <Spinner/>;

  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <SchoolHeader small/>
      <TopBar name={studentNameText(profile.name)}
        sub={`Teacher${mySection?" · Adviser: "+mySection.name:""}${profile.is_curriculum_head?" · Curriculum Head Gr."+profile.assigned_grade_level:""}`}
        onLogout={onLogout}/>
      <Toast msg={toast}/>
      <TeacherFieldBuddy profile={profile} subjects={subjects} subjectAssignments={subjectAssignments} sections={sections} mySection={mySection} classStudents={classStudents} appointments={appointments} onNavigate={setTab}/>
      <div className="teacher-welcome-wrap">
        <WelcomePanel profile={profile} role="teacher" stats={[
          {icon:"👥",value:mySection?classStudents.length:(profile.is_curriculum_head?`Gr.${profile.assigned_grade_level}`:"—"),label:mySection?"Advisory learners":profile.is_curriculum_head?"Curriculum grade":"Teaching scope"},
          {icon:"📚",value:subjects.length,label:"Assigned subjects"},
          {icon:"📊",value:profile.is_curriculum_head?"Grade-wide":mySection?"Section-wide":"Subject review",label:"Analytics scope"}
        ]}/>
      </div>
      {editStudent&&(
        <EditStudentModal student={editStudent}
          sections={sections.filter(s=>s.grade_level===profile.assigned_grade_level)}
          qualifications={qualifications} canChangeGrade={false}
          onSave={handleUpdateStudent} onClose={()=>setEditStudent(null)}/>
      )}
      <div className="dashboard-scroll">
        <div className="dashboard-inner">
          <div key={tab} className="tab-scene">

        {tab==="encode"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>✏️ Encode Grades</div>
            <Card style={{marginBottom:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Subject</label>
                  <select value={selSubject}
                    onChange={e=>{
                      const sub=subjects.find(s=>s.id===e.target.value);
                      setSelSubject(e.target.value);
                      const assigned=subjectAssignments.filter(a=>a.subject_id===e.target.value);
                      const scoped=assigned.map(a=>a.section_id).filter(Boolean);
                      setSelSection(scoped.length===1?scoped[0]:(!scoped.length ? (sub?.section_id||"") : ""));
                    }}>
                    <option value="">-- Select --</option>
                    {subjects
                      .filter(s=>!isMapehParent(s,subjects))
                      // An SHS subject tagged with a specific term (subjects.term)
                      // only ever runs in that term — hide it from every other
                      // term's dropdown so a teacher can't accidentally encode a
                      // grade against it outside the term it actually exists in.
                      // A subject with no term set (JHS/TVE, or a year-round SHS
                      // subject) always shows, exactly as before.
                      .filter(s=>!s.term||s.term===selTerm)
                      .map(s=>{
                      const assigned=subjectAssignments.filter(a=>a.subject_id===s.id);
                      const secNames=assigned.map(a=>sections.find(sc=>sc.id===a.section_id)?.name).filter(Boolean);
                      return <option key={s.id} value={s.id}>
                        {studentDisplay(s)} (Gr.{s.grade_level}{s.tve_qualification?` · ${s.tve_qualification}`:""}{s.term?` · Term ${s.term} only`:""}{s.curriculum==="als"?" · ALS":""}{secNames.length?` · ${secNames.join(", ")}`:(s.section_id?` · Sec. ${sections.find(sc=>sc.id===s.section_id)?.name||"?"}`:"")})
                      </option>;
                    })}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Term</label>
                  <select value={selTerm} onChange={e=>setSelTerm(parseInt(e.target.value))}>
                    <option value={1}>Term 1</option><option value={2}>Term 2</option>
                    <option value={3}>Term 3</option>
                  </select>
                </div>
              </div>
              {selSubject&&(()=>{
                const sub=subjects.find(s=>s.id===selSubject);
                const assigned=subjectAssignments.filter(a=>a.subject_id===sub?.id);
                const assignedSectionIds=assigned.map(a=>a.section_id).filter(Boolean);
                const hasGradeWideAssignment=assigned.some(a=>!a.section_id);
                if (assignedSectionIds.length===1&&!hasGradeWideAssignment) {
                  const secName=sections.find(sc=>sc.id===assignedSectionIds[0])?.name||"?";
                  return (
                    <div style={{fontSize:12,color:T.green2,fontWeight:600,
                      background:"#EEF6EC",borderRadius:6,padding:"6px 10px"}}>
                      📍 Section: {secName} · assigned to you
                    </div>
                  );
                }
                const secOptions=(assignedSectionIds.length&&!hasGradeWideAssignment)
                  ? sections.filter(sec=>assignedSectionIds.includes(sec.id))
                  : sections.filter(sec=>sec.grade_level===sub?.grade_level);
                return (
                  <div>
                    <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>
                      Section — encode one section at a time for easier monitoring
                    </label>
                    <select value={selSection} onChange={e=>setSelSection(e.target.value)}>
                      <option value="">-- Select Section --</option>
                      {secOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                );
              })()}
            </Card>
            {selSubject&&selSection?(
              <Card>
                <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:2}}>
                  {subjects.find(s=>s.id===selSubject)?.name} — {sections.find(s=>s.id===selSection)?.name} — Term {selTerm}
                </div>
                {subjects.find(s=>s.id===selSubject)?.tve_qualification&&(
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:8}}>
                    🎯 TVE Qualification: <strong style={{color:T.green2}}>
                      {subjects.find(s=>s.id===selSubject)?.tve_qualification}
                    </strong> · showing only students assigned to this qualification
                  </div>
                )}
                {subjects.find(s=>s.id===selSubject)?.parent_subject_id&&(
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:8}}>
                    🧩 MAPEH component — this grade will be averaged with the other
                    component to produce the student's MAPEH grade.
                  </div>
                )}
                {students.length===0
                  ?<div style={{textAlign:"center",color:T.gray,padding:20}}>
                      No students found{subjects.find(s=>s.id===selSubject)?.tve_qualification
                        ?" for this TVE qualification in this section.":" in this section."}
                    </div>
                  :[
                    ["Male","♂","#1976d2","#e3f2fd"],
                    ["Female","♀","#c2185b","#fce4ec"]
                  ].map(([gender,icon,color,bg])=>{
                    const group=students.filter(s=>s.gender===gender);
                    if(!group.length) return null;
                    return <div key={gender} style={{marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:800,color,background:bg,padding:"5px 9px",borderRadius:6,borderLeft:`3px solid ${color}`,marginBottom:4,letterSpacing:.2}}>
                        {icon} {gender.toUpperCase()} ({group.length})
                      </div>
                      {group.map(s=>(
                        <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,
                          padding:"8px 8px",borderBottom:"1px solid #E3EEDD"}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:T.text}}>{studentDisplay(s)}</div>
                            <div style={{fontSize:11,color:T.textMuted}}>LRN: {s.lrn}</div>
                          </div>
                          <input type="number" min="0" max="100" style={{width:72,textAlign:"center"}}
                            value={getGradeVal(s.id)}
                            onChange={e=>setLocalGrades(p=>({...p,[`${s.id}-${selSubject}-${selTerm}`]:e.target.value}))}
                            placeholder="0–100"/>
                        </div>
                      ))}
                    </div>;
                  })
                }
                <Btn onClick={saveGrades} style={{width:"100%",marginTop:12}}>💾 Save Grades</Btn>
              </Card>
            ):(
              <Card><div style={{textAlign:"center",color:T.gray,padding:20}}>
                {selSubject?"Select a section to begin encoding.":"Select a subject to begin encoding."}
              </div></Card>
            )}
          </div>
        )}

        {tab==="myclass"&&mySection&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:4}}>🏫 My Advisory Class</div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>
              {mySection.name} · Grade {mySection.grade_level} · {classStudents.length} students
            </div>

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:8}}>📈 Grade Encoding Progress</div>
            <EncodingProgressCard
              result={computeSectionEncoding(mySection,allGradeSubjects,classStudents,classGrades)}/>
            {(()=>{
              const enc=computeSectionEncoding(mySection,allGradeSubjects,classStudents,classGrades);
              const summary=computeGradeSummary(summaryTerm);
              const avgValues=summary.map(x=>x.average).filter(Boolean);
              const classAvg=avgValues.length?avg(avgValues):0;
              return (
                <div className="insight-grid teacher-insights">
                  <Card className="insight-card" style={{display:"flex",alignItems:"center",gap:16}}>
                    <ProgressRing value={enc.percent||0} label="Encoded"/>
                    <div>
                      <div className="insight-kicker">CLASS READINESS</div>
                      <div className="insight-value">{enc.percent||0}%</div>
                      <div className="insight-note">{enc.encoded||0} of {enc.total||0} grade entries encoded</div>
                    </div>
                  </Card>
                  <Card className="insight-card">
                    <div className="insight-kicker">CLASS AVERAGE</div>
                    <div className="insight-value">{classAvg?Math.round(classAvg*100)/100:"—"}</div>
                    <div className="insight-note">Based on {summaryTerm==="final"?"final":`Term ${summaryTerm}`} records</div>
                    {avgValues.length>0&&<MiniBarChart
                      data={[
                        {label:"90+",value:avgValues.filter(v=>v>=90).length},
                        {label:"85–89",value:avgValues.filter(v=>v>=85&&v<90).length},
                        {label:"80–84",value:avgValues.filter(v=>v>=80&&v<85).length},
                        {label:"<80",value:avgValues.filter(v=>v<80).length}
                      ]}
                      label="Learners by average band"
                    />}
                  </Card>
                </div>
              );
            })()}

            <Card style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,color:T.green2}}>📊 Grade Summary</div>
                <select value={summaryTerm} onChange={e=>{
                  const v=e.target.value;
                  setSummaryTerm(v==="final"?"final":parseInt(v));
                }} style={{fontSize:12,padding:"4px 8px"}}>
                  <option value={1}>Term 1</option>
                  <option value={2}>Term 2</option>
                  <option value={3}>Term 3</option>
                  <option value="final">Final Average</option>
                </select>
              </div>
              {allGradeSubjects.length===0||classStudents.length===0
                ?<div style={{fontSize:12,color:T.gray,textAlign:"center",padding:14}}>
                    No subjects or students to summarize yet.
                  </div>
                :(
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr style={{background:T.green4+"22"}}>
                        <th style={{padding:"6px 8px",textAlign:"left",position:"sticky",left:0,
                          background:"#fff",borderBottom:"2px solid "+T.green3}}>Student</th>
                        {allGradeSubjects.filter(sub=>(!sub.section_id||sub.section_id===mySection.id)&&!sub.parent_subject_id).map(sub=>(
                          <th key={sub.id} style={{padding:"6px 6px",textAlign:"center",
                            borderBottom:"2px solid "+T.green3,whiteSpace:"nowrap",fontWeight:600}}>
                            {sub.name}
                            {sub.tve_qualification&&(
                              <div style={{fontSize:9,fontWeight:400,color:T.textMuted}}>
                                {sub.tve_qualification}
                              </div>
                            )}
                          </th>
                        ))}
                        <th style={{padding:"6px 8px",textAlign:"center",
                          borderBottom:"2px solid "+T.green3,fontWeight:700}}>Average</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computeGradeSummary(summaryTerm).map(({student,bySubject,average})=>(
                        <tr key={student.id} style={{borderBottom:"1px solid #f0f0f0"}}>
                          <td style={{padding:"6px 8px",fontWeight:600,position:"sticky",left:0,
                            background:"#fff",whiteSpace:"nowrap"}}>{studentDisplay(student)}</td>
                          {allGradeSubjects.filter(sub=>(!sub.section_id||sub.section_id===mySection.id)&&!sub.parent_subject_id).map(sub=>(
                            <td key={sub.id} style={{padding:"6px 6px",textAlign:"center",
                              color:bySubject[sub.id]===null?T.gray:T.text}}>
                              {bySubject[sub.id]??"—"}
                            </td>
                          ))}
                          <td style={{padding:"6px 8px",textAlign:"center",fontWeight:700,
                            color:average>=90?T.green3:T.text}}>
                            {average??"—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {classStudents.filter(s=>s.gender==="Male").length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:T.blue,padding:"4px 10px",
                  background:"#e3f2fd",borderRadius:6,borderLeft:"3px solid #1976d2",marginBottom:6}}>
                  ♂ Male ({classStudents.filter(s=>s.gender==="Male").length})
                </div>
                {classStudents.filter(s=>s.gender==="Male").map(s=>(
                  <Card key={s.id} style={{marginBottom:6,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:T.text}}>{studentDisplay(s)}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>LRN: {s.lrn} · {s.birthday||"—"}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>{s.address||"—"}</div>
                      </div>
                      {s.tve_qualification&&<Badge text={s.tve_qualification} color="#7b1fa2"/>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {classStudents.filter(s=>s.gender==="Female").length>0&&(
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#c2185b",padding:"4px 10px",
                  background:"#fce4ec",borderRadius:6,borderLeft:"3px solid #c2185b",marginBottom:6}}>
                  ♀ Female ({classStudents.filter(s=>s.gender==="Female").length})
                </div>
                {classStudents.filter(s=>s.gender==="Female").map(s=>(
                  <Card key={s.id} style={{marginBottom:6,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:T.text}}>{studentDisplay(s)}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>LRN: {s.lrn} · {s.birthday||"—"}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>{s.address||"—"}</div>
                      </div>
                      {s.tve_qualification&&<Badge text={s.tve_qualification} color="#7b1fa2"/>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {classStudents.length===0&&(
              <Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No students yet.</div></Card>
            )}
          </div>
        )}

        {tab==="attendance"&&mySection&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📆 Daily Attendance</div>
            <Card style={{marginBottom:12}}>
              <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Select Month</label>
              <select value={selAttMonth?`${selAttMonth.month}-${selAttMonth.year}-${selAttMonth.term}`:""}
                onChange={e=>{
                  if (!e.target.value){setSelAttMonth(null);return;}
                  const [m,y,t]=e.target.value.split("-");
                  setSelAttMonth(TERM_MONTHS.find(x=>x.month===parseInt(m)&&x.year===parseInt(y)&&x.term===parseInt(t))||null);
                }}>
                <option value="">-- Select Month --</option>
                {TERM_MONTHS.map((m,i)=>{
                  const days=schoolDaysInMonth(m,holidays);
                  return (
                    <option key={i} value={`${m.month}-${m.year}-${m.term}`}>
                      {m.label} (Term {m.term}) — {days.length} school days
                    </option>
                  );
                })}
              </select>
            </Card>
            {selAttMonth&&(()=>{
              const days=schoolDaysInMonth(selAttMonth,holidays);
              const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
              return (
                <Card>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.green2}}>
                      {selAttMonth.label} — Term {selAttMonth.term}
                    </div>
                    <div style={{fontSize:11,color:T.textMuted}}>{days.length} school days</div>
                  </div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:10}}>
                    Every learner defaults to <strong style={{color:T.green3}}>Present</strong> — tap a box to flag an absence.
                    Weekends and holidays are already excluded.
                  </div>
                  {days.length===0
                    ?<div style={{textAlign:"center",color:T.red,padding:20}}>
                        No school days in this range. Check the Non-School Days list with your admin.
                      </div>
                    :classStudents.length===0
                    ?<div style={{textAlign:"center",color:T.gray,padding:20}}>No students.</div>
                    :(
                      <div style={{overflowX:"auto",marginBottom:12}}>
                        <table style={{borderCollapse:"collapse",fontSize:11,minWidth:"100%"}}>
                          <thead>
                            <tr>
                              <th style={{position:"sticky",left:0,background:T.bgCard,zIndex:1,
                                textAlign:"left",padding:"4px 8px",borderBottom:"2px solid "+T.green3,
                                minWidth:130}}>Learner</th>
                              {days.map(d=>(
                                <th key={d.date} onClick={()=>markAllPresent(d.date)}
                                  title="Click to mark everyone present this day"
                                  style={{padding:"2px 3px",textAlign:"center",cursor:"pointer",
                                  borderBottom:"2px solid "+T.green3,minWidth:26,color:T.textMuted,fontWeight:600}}>
                                  <div>{DOW[d.dow]}</div><div>{d.day}</div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {classStudents.map(s=>(
                              <tr key={s.id}>
                                <td style={{position:"sticky",left:0,background:T.bgCard,zIndex:1,
                                  padding:"4px 8px",borderBottom:"1px solid #E3EEDD",fontWeight:600,color:T.text}}>
                                  {studentDisplay(s)}
                                </td>
                                {days.map(d=>{
                                  const status=getDailyStatus(s.id,d.date);
                                  const present=status==="present";
                                  return (
                                    <td key={d.date} style={{padding:2,textAlign:"center",
                                      borderBottom:"1px solid #E3EEDD"}}>
                                      <div onClick={()=>toggleDaily(s.id,d.date)}
                                        style={{width:20,height:20,borderRadius:4,margin:"0 auto",
                                          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                                          fontWeight:800,fontSize:11,
                                          background:present?"#EEF6EC":"#ffebee",
                                          color:present?T.green3:T.red,
                                          border:`1px solid ${present?"#C9E0BE":"#f0c0c0"}`}}>
                                        {present?"✓":"✗"}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  }
                  <Btn onClick={saveDailyAttendance} disabled={savingAtt||days.length===0}
                    style={{width:"100%"}}>
                    {savingAtt?"⏳ Saving...":"💾 Save Daily Attendance"}
                  </Btn>
                </Card>
              );
            })()}
          </div>
        )}

        {tab==="chstudents"&&profile.is_curriculum_head&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>
              🎓 Students — Grade {profile.assigned_grade_level}
            </div>
            <AddStudentForm sections={sections} gradeFilter={profile.assigned_grade_level}
              onAdd={handleAddStudent} loading={addingStudent} qualifications={qualifications}/>
            {chStudents.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No students yet.</div></Card>
              :<StudentListGrouped students={chStudents}
                  sections={sections.filter(s=>s.grade_level===profile.assigned_grade_level)}
                  teachers={[]} showActions={false}
                  onEdit={s=>setEditStudent(s)} qualifications={qualifications}/>
            }
          </div>
        )}

        {tab==="review"&&(
          <SubjectGradeReview profile={profile} subjects={subjects} subjectAssignments={subjectAssignments} sections={sections}/>
        )}
        {tab==="analytics"&&(
          <TeacherAnalytics profile={profile} subjects={subjects} subjectAssignments={subjectAssignments} sections={sections} mySection={mySection} classStudents={classStudents}/>
        )}
        {tab==="appointments"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📅 Appointments</div>
            {mySection&&(
              <Card style={{marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>
                  👨‍👩‍👧 Schedule Parent-Teacher Conference
                </div>
                <div style={{fontSize:11,color:T.textMuted,marginBottom:10}}>
                  As class adviser, you can book a conference directly on behalf of your advisory students (max 3 per day).
                </div>
                <div style={{display:"grid",gap:8,marginBottom:8}}>
                  <select value={advApptForm.studentId}
                    onChange={e=>setAdvApptForm(p=>({...p,studentId:e.target.value}))}>
                    <option value="">-- Select Student --</option>
                    {classStudents.map(s=><option key={s.id} value={s.id}>{studentDisplay(s)} (LRN: {s.lrn})</option>)}
                  </select>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <input type="date" value={advApptForm.date}
                      onChange={e=>setAdvApptForm(p=>({...p,date:e.target.value}))}/>
                    <input type="time" value={advApptForm.time}
                      onChange={e=>setAdvApptForm(p=>({...p,time:e.target.value}))}/>
                  </div>
                  <textarea rows={2} placeholder="Reason / Purpose"
                    value={advApptForm.reason}
                    onChange={e=>setAdvApptForm(p=>({...p,reason:e.target.value}))}/>
                </div>
                {advApptMsg&&<div style={{fontSize:12,marginBottom:10,padding:"8px 12px",borderRadius:6,
                  background:advApptMsg.startsWith("✅")?"#EEF6EC":"#ffebee",
                  color:advApptMsg.startsWith("✅")?T.green2:T.red}}>{advApptMsg}</div>}
                <Btn onClick={submitAdvAppt} style={{width:"100%"}}>📩 Schedule Conference</Btn>
              </Card>
            )}
            {appointments.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No appointments.</div></Card>
              :appointments.map(a=>(
                <Card key={a.id} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontWeight:700,color:T.text}}>{studentNameText(a.student_name)}</div>
                    <Badge text={a.status}
                      color={a.status==="Pending"?T.yellow:a.status==="Approved"?T.green4:T.red}/>
                  </div>
                  <div style={{fontSize:12,color:T.textMuted}}>📅 {a.date} at {a.time}</div>
                  <div style={{fontSize:12,marginTop:4,color:T.text}}>{a.reason}</div>
                  {a.booked_by==="adviser"&&(
                    <div style={{fontSize:10,marginTop:4,color:T.green3,fontWeight:700}}>
                      🧑‍🏫 Scheduled by adviser
                    </div>
                  )}
                  {a.status==="Pending"&&(
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <Btn color={T.green3} style={{flex:1,padding:"7px",fontSize:12}}
                        onClick={()=>updateApptStatus(a.id,"Approved")}>✅ Approve</Btn>
                      <Btn color={T.red} style={{flex:1,padding:"7px",fontSize:12}}
                        onClick={()=>updateApptStatus(a.id,"Declined")}>❌ Decline</Btn>
                    </div>
                  )}
                </Card>
              ))
            }
          </div>
        )}
        {tab==="honors"&&mySection&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>
              🏆 Honors List
            </div>
            <Card style={{marginBottom:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Honor Threshold</div>
                  <input type="number" min={75} max={100} value={honorsThreshold}
                    onChange={e=>setHonorsThreshold(parseFloat(e.target.value)||90)}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Scope</div>
                  <select value={honorsScope} onChange={e=>setHonorsScope(e.target.value)}>
                    <option value="section">My Section ({mySection.name})</option>
                    <option value="grade">Whole Grade {mySection.grade_level}</option>
                  </select>
                </div>
              </div>
              <div style={{fontSize:10,color:T.textMuted,marginTop:8}}>
                Students with a general average ≥ {honorsThreshold} qualify. Final cutoffs for S.Y. 2026–2027
                are pending official DepEd confirmation — adjust the threshold above as needed once announced.
              </div>
            </Card>

            {["Term 1","Term 2","Term 3","Final / Year-End"].map((label,idx)=>{
              const roll=computeHonorsRoll();
              const qualifiers=roll.filter(r=>{
                const avg=idx<3?r.termAvgs[idx]:r.finalAvg;
                return avg!==null&&avg>=honorsThreshold;
              }).sort((a,b)=>{
                const avgA=idx<3?a.termAvgs[idx]:a.finalAvg;
                const avgB=idx<3?b.termAvgs[idx]:b.finalAvg;
                return avgB-avgA;
              });
              return (
                <Card key={label} style={{marginBottom:10}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:8}}>
                    {label} {idx===3&&"🎓"}
                  </div>
                  {qualifiers.length===0
                    ?<div style={{fontSize:12,color:T.gray,textAlign:"center",padding:10}}>
                        No qualifiers yet.
                      </div>
                    :qualifiers.map(({student,termAvgs,finalAvg})=>{
                      const avg=idx<3?termAvgs[idx]:finalAvg;
                      return (
                        <div key={student.id} style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f0f0f0"}}>
                          <div style={{fontSize:12,fontWeight:600,color:T.text}}>{studentDisplay(student)}</div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <Badge text={String(avg)} color={T.green3}/>
                            <Btn color={T.yellow} style={{padding:"4px 8px",fontSize:10}}
                              onClick={()=>generateCertificate(student,label,avg)}>
                              🏅 Certificate
                            </Btn>
                          </div>
                        </div>
                      );
                    })
                  }
                </Card>
              );
            })}
          </div>
        )}
        {tab==="reports"&&mySection&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:4}}>
              📄 DepEd Forms
            </div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>
              {mySection.name} · Grade {mySection.grade_level} · {classStudents.length} students
            </div>

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
              School Form 2 — Daily Attendance Report
            </div>
            <Card style={{marginBottom:16}}>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Month</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select style={{flex:"1 1 200px"}}
                  value={sf2Month?`${sf2Month.month}-${sf2Month.year}-${sf2Month.term}`:""}
                  onChange={e=>{
                    if (!e.target.value){setSf2Month(null);return;}
                    const [m,y,t]=e.target.value.split("-");
                    setSf2Month(TERM_MONTHS.find(x=>x.month===parseInt(m)&&x.year===parseInt(y)&&x.term===parseInt(t))||null);
                  }}>
                  <option value="">-- Select Month --</option>
                  {TERM_MONTHS.map((m,i)=><option key={i} value={`${m.month}-${m.year}-${m.term}`}>{m.label}</option>)}
                </select>
                <Btn onClick={generateSF2} style={{flexShrink:0}}>📄 Generate SF2 PDF</Btn>
              </div>
            </Card>

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
              School Form 9 — Report Cards
            </div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Period</div>
              <select value={sf9Term} onChange={e=>{
                const v=e.target.value;
                setSf9Term(v==="final"?"final":parseInt(v));
              }}>
                <option value={1}>Term 1</option>
                <option value={2}>Term 2</option>
                <option value={3}>Term 3</option>
                <option value="final">Final / Year-End</option>
              </select>
            </Card>
            {classStudents.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No students in your advisory class yet.</div></Card>
              :classStudents.map(s=>(
                <Card key={s.id} style={{marginBottom:8,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:T.text}}>{studentDisplay(s)}</div>
                      <div style={{fontSize:11,color:T.textMuted}}>LRN: {s.lrn}</div>
                    </div>
                    <Btn color={T.blue} style={{padding:"6px 12px",fontSize:11}}
                      onClick={()=>generateSF9(s)}>
                      📄 Generate SF9
                    </Btn>
                  </div>
                </Card>
              ))
            }
          </div>
        )}
          </div>
        </div>
      </div>
      <BottomNav tabs={tabs} active={tab} setActive={setTab}/>
    </div>
  );
};

const QuickAssignmentForm = ({subjects,sections,teachers,onAssign,busy}) => {
  const [subjectId,setSubjectId]=useState("");
  const [teacherId,setTeacherId]=useState("");
  const [sectionIds,setSectionIds]=useState([]);
  const [allSections,setAllSections]=useState(false);
  const toggle=id=>setSectionIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
      <select value={subjectId} onChange={e=>setSubjectId(e.target.value)}>
        <option value="">-- Subject --</option>
        {subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select value={teacherId} onChange={e=>setTeacherId(e.target.value)}>
        <option value="">-- Teacher --</option>
        {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
    <label style={{display:"flex",alignItems:"center",gap:7,fontSize:11,fontWeight:700,color:T.text,marginBottom:8,cursor:"pointer"}}>
      <input type="checkbox" checked={allSections} onChange={e=>{setAllSections(e.target.checked);if(e.target.checked)setSectionIds([]);}} style={{width:16,height:16}}/>
      Assign to all sections in this grade
    </label>
    {!allSections&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:9}}>
      {sections.map(sec=><button key={sec.id} onClick={()=>toggle(sec.id)} style={{border:"1px solid #cbdcc9",borderRadius:999,padding:"6px 9px",fontSize:10,fontWeight:800,cursor:"pointer",background:sectionIds.includes(sec.id)?T.green3:T.white,color:sectionIds.includes(sec.id)?T.white:T.textMuted}}>{sectionIds.includes(sec.id)?"✓ ":""}{sec.name}</button>)}
    </div>}
    <Btn disabled={busy||!subjectId||!teacherId||(!allSections&&!sectionIds.length)} onClick={()=>onAssign({subjectId,teacherId,sectionIds,allSections})} style={{width:"100%"}}>{busy?"⏳ Saving...":allSections?"⚡ Assign to all sections":`⚡ Assign to ${sectionIds.length||0} section${sectionIds.length===1?"":"s"}`}</Btn>
  </div>;
};

// ─── ADMIN DASHBOARD ─────────────────────────────────────
const AdminDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("overview");
  const [students,setStudents]=useState([]);
  const [teachers,setTeachers]=useState([]);
  const [subjects,setSubjects]=useState([]);
  const [subjectAssignments,setSubjectAssignments]=useState([]);
  const [assignmentGrade,setAssignmentGrade]=useState(7);
  const [assignmentSearch,setAssignmentSearch]=useState("");
  const [assignmentTeacherFilter,setAssignmentTeacherFilter]=useState("");
  const [assignmentBusy,setAssignmentBusy]=useState(false);
  const [grades,setGrades]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [sections,setSections]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [holidays,setHolidays]=useState([]);
  const [toast,setToast]=useState("");
  const [loading,setLoading]=useState(true);
  const [editGrade,setEditGrade]=useState(null);
  const [editStudent,setEditStudent]=useState(null);
  const [editTeacher,setEditTeacher]=useState(null);
  const [editSection,setEditSection]=useState(null);
  const [editSubject,setEditSubject]=useState(null);
  const [resetModal,setResetModal]=useState(null);
  const [addingStudent,setAddingStudent]=useState(false);
  const [qualifications,setQualifications]=useState([]); // [{id,name}] — admin-managed TVE qualifications
  const [nQualification,setNQualification]=useState("");

  // Settings state
  const [isLocked,setIsLocked]=useState(false);
  const [genericPass,setGenericPass]=useState("");
  const [showGenericPass,setShowGenericPass]=useState(false);
  const [applyingPass,setApplyingPass]=useState(false);

  const [nTeacher,setNTeacher]=useState({name:"",email:"",password:""});
  const [nSubject,setNSubject]=useState({name:"",grade_level:7,teacher_id:"",tve_qualification:"",section_id:"",term:"",curriculum:"regular",shs_track:""});
  const [nGrade,setNGrade]=useState({student_id:"",subject_id:"",term:1,grade:""});
  const [nSection,setNSection]=useState({name:"",grade_level:7,adviser_id:""});

  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),3000);};

  const fetchAll=useCallback(async()=>{
    setLoading(true);
    const [sR,tR,subR,asR,gR,aR,secR,calR,settR,qR,holR]=await Promise.all([
      supabase.from("profiles").select("*").eq("role","student").order("grade_level").order("name"),
      supabase.from("profiles").select("*").eq("role","teacher").order("name"),
      supabase.from("subjects").select("*").order("grade_level"),
      supabase.from("subject_assignments").select("*"),
      supabase.from("grades").select("*"),
      supabase.from("appointments").select("*").order("created_at",{ascending:false}),
      supabase.from("sections").select("*").order("grade_level").order("name"),
      supabase.from("school_calendar").select("*").order("year").order("month"),
      supabase.from("app_settings").select("*"),
      supabase.from("tve_qualifications").select("*").order("name"),
      supabase.from("school_holidays").select("*").order("date"),
    ]);
    if (sR.data) setStudents(sR.data);
    if (tR.data) setTeachers(tR.data);
    if (subR.data) setSubjects(subR.data);
    if (asR.data) setSubjectAssignments(asR.data);
    if (gR.data) setGrades(gR.data);
    if (aR.data) setAppointments(aR.data);
    if (secR.data) setSections(secR.data);
    if (calR.data) setCalendar(calR.data);
    if (qR.data) setQualifications(qR.data);
    if (holR.data) setHolidays(holR.data);
    if (settR.data) {
      const lockSetting=settR.data.find(s=>s.key==="student_access_locked");
      if (lockSetting) setIsLocked(lockSetting.value==="true");
    }
    setLoading(false);
  },[]);

  useEffect(()=>{fetchAll();},[fetchAll]);

  const addHoliday=async(date,label)=>{
    const {error}=await supabase.from("school_holidays").insert({date,label});
    if (error){notify("❌ "+error.message);return;}
    notify("✅ Non-school day added!"); fetchAll();
  };
  const deleteHoliday=async id=>{
    await supabase.from("school_holidays").delete().eq("id",id);
    notify("✅ Removed."); fetchAll();
  };

  // ── SETTINGS ──
  const toggleLock=async()=>{
    const newVal=!isLocked;
    if (!window.confirm(newVal
      ?"Lock student access? Students will not be able to login."
      :"Unlock student access? Students will be able to login again.")) return;
    const {error}=await supabase.from("app_settings")
      .upsert({key:"student_access_locked",value:String(newVal)},{onConflict:"key"});
    if (error){notify("❌ "+error.message);return;}
    setIsLocked(newVal);
    notify(newVal?"🔒 Student access locked!":"🔓 Student access unlocked!");
  };

  const applyGenericPassword=async()=>{
    if (!genericPass||genericPass.length<6){
      notify("❌ Password must be at least 6 characters."); return;
    }
    if (!window.confirm(`Apply "${genericPass}" as the password for ALL ${students.length} students? This cannot be undone.`)) return;
    setApplyingPass(true);
    notify("⏳ Applying password to all students...");
    let success=0,failed=0;
    for (const student of students) {
      const result=await edgeCall("reset-password",{userId:student.id,newPassword:genericPass});
      if (result.error) failed++;
      else success++;
    }
    setApplyingPass(false);
    setGenericPass("");
    notify(`✅ Done! ${success} updated${failed>0?`, ${failed} failed`:""}.`);
  };

  // ── STUDENTS ──
  const handleAddStudent=async form=>{
    if (!form.name||!form.lrn||!form.email||!form.password){
      notify("❌ Name, LRN, email and password required."); return;
    }
    const gradeLevel=parseInt(form.grade_level);
    if (gradeLevel>=8&&gradeLevel<=10&&!form.tve_qualification){
      notify("❌ TVE Qualification is required for Grades 8-10."); return;
    }
    if ((gradeLevel===11||gradeLevel===12)&&form.curriculum!=="als"&&!form.shs_track){
      notify("❌ Track is required for Grades 11-12."); return;
    }
    setAddingStudent(true);
    try {
      const result=await edgeCall("create-user",{
        role:"student",email:form.email,password:form.password,
        name:form.name,lrn:form.lrn,grade_level:gradeLevel,
        section_id:form.section_id||null,gender:form.gender,
        birthday:form.birthday||null,address:form.address,
        tve_qualification:(gradeLevel>=8&&gradeLevel<=10)?form.tve_qualification:null,
        shs_track:(gradeLevel===11||gradeLevel===12)?form.shs_track:null,
        curriculum:(gradeLevel===11||gradeLevel===12)?(form.curriculum||"regular"):"regular",
      });
      if (result.error){notify("❌ "+result.error);return;}
      notify("✅ Student added!");
      // Small delay guards against a race where the profile row (created by a
      // DB trigger after the auth user is created) hasn't committed yet.
      await new Promise(r=>setTimeout(r,400));
      await fetchAll();
    } catch (err) {
      notify("❌ "+(err.message||"Failed to add student."));
    } finally {
      setAddingStudent(false);
    }
  };

  const delStudent=async id=>{
    if (!window.confirm("Delete this student? All their data will be removed.")) return;
    notify("⏳ Deleting...");
    const result=await edgeCall("delete-user",{userId:id,role:"student"});
    if (result.error){notify("❌ "+result.error);return;}
    notify("🗑️ Student deleted."); fetchAll();
  };

  const reassignSection=async(studentId,sectionId)=>{
    const sec=sections.find(s=>s.id===sectionId);
    const stu=students.find(s=>s.id===studentId);
    const gradeLevel=sec?sec.grade_level:stu?.grade_level;
    await supabase.from("profiles").update({section_id:sectionId||null,grade_level:gradeLevel}).eq("id",studentId);
    notify("✅ Section reassigned!"); fetchAll();
  };

  const handleUpdateStudent=async updates=>{
    if (!editStudent) return;
    const {grade_level,...rest}=updates;
    const result=await edgeCall("update-student",{studentId:editStudent.id,updates:rest,grade_level});
    if (result.error){notify("❌ "+result.error);return;}
    notify("✅ Learner updated!");
    setEditStudent(null);
    fetchAll();
  };

  // ── TEACHERS ──
  const addTeacher=async()=>{
    if (!nTeacher.name||!nTeacher.email||!nTeacher.password){
      notify("❌ Name, email and password required."); return;
    }
    notify("⏳ Creating teacher...");
    const result=await edgeCall("create-user",{role:"teacher",email:nTeacher.email,password:nTeacher.password,name:nTeacher.name});
    if (result.error){notify("❌ "+result.error);return;}
    setNTeacher({name:"",email:"",password:""});
    notify("✅ Teacher added!"); fetchAll();
  };

  const updateTeacher=async updates=>{
    if (!editTeacher) return;
    const {error}=await supabase.from("profiles").update(updates).eq("id",editTeacher.id);
    if (error){notify("❌ "+error.message);return;}
    notify("✅ Teacher updated!");
    setEditTeacher(null);
    fetchAll();
  };

  const delTeacher=async id=>{
    if (!window.confirm("Delete this teacher?")) return;
    notify("⏳ Deleting...");
    const result=await edgeCall("delete-user",{userId:id,role:"teacher"});
    if (result.error){notify("❌ "+result.error);return;}
    notify("🗑️ Teacher deleted."); fetchAll();
  };

  const toggleCurriculumHead=async(teacher,gl)=>{
    const isHead=teacher.is_curriculum_head&&teacher.assigned_grade_level===parseInt(gl);
    await supabase.from("profiles").update({
      is_curriculum_head:!isHead,assigned_grade_level:isHead?null:parseInt(gl)
    }).eq("id",teacher.id);
    notify(isHead?"✅ Removed!":"✅ Curriculum Head assigned!"); fetchAll();
  };

  const handleResetPassword=async newPassword=>{
    if (!newPassword||newPassword.length<6){notify("❌ Min 6 characters.");return;}
    notify("⏳ Resetting...");
    const result=await edgeCall("reset-password",{userId:resetModal.userId,newPassword});
    if (result.error){notify("❌ "+result.error);return;}
    notify(`✅ Password reset for ${resetModal.name}!`);
    setResetModal(null);
  };

  // ── SUBJECTS ──
  // MAPEH is graded through two components (PE and Health; Music and Arts),
  // each its own subject row linked back to the parent via parent_subject_id.
  const addMapehComponents=async(parent)=>{
    const {error}=await supabase.from("subjects").insert([
      {name:"PE and Health",grade_level:parent.grade_level,section_id:parent.section_id||null,
        parent_subject_id:parent.id},
      {name:"Music and Arts",grade_level:parent.grade_level,section_id:parent.section_id||null,
        parent_subject_id:parent.id},
    ]);
    if (error){notify("❌ "+error.message);return;}
    notify("✅ PE and Health / Music and Arts components added!"); fetchAll();
  };

  const addSubject=async()=>{
    if (!nSubject.name){notify("❌ Subject name required.");return;}
    const {data:inserted,error}=await supabase.from("subjects").insert({
      name:nSubject.name,grade_level:parseInt(nSubject.grade_level),teacher_id:nSubject.teacher_id||null,
      tve_qualification:nSubject.tve_qualification||null,section_id:nSubject.section_id||null,
      term:nSubject.term?parseInt(nSubject.term):null,
      curriculum:nSubject.curriculum==="als"?"als":"regular",
      shs_track:nSubject.shs_track||null,
    }).select().single();
    if (error){notify("❌ "+error.message);return;}
    if (inserted && nSubject.teacher_id) {
      const {error:assignmentError}=await supabase.from("subject_assignments").insert({
        subject_id:inserted.id,teacher_id:nSubject.teacher_id,section_id:nSubject.section_id||null
      });
      if (assignmentError){notify("⚠️ Subject created, but teacher assignment failed: "+assignmentError.message);}
    }
    setNSubject({name:"",grade_level:7,teacher_id:"",tve_qualification:"",section_id:"",term:"",curriculum:"regular",shs_track:""});
    // MAPEH is never graded directly — auto-create its two components so
    // there's immediately something for teachers to encode grades against.
    if (inserted&&inserted.name.trim().toUpperCase()==="MAPEH") {
      await addMapehComponents(inserted);
    } else {
      notify("✅ Subject added!"); fetchAll();
    }
  };

  const delSubject=async id=>{
    // Clean up MAPEH components explicitly (rather than relying solely on
    // DB cascade) so their grades don't linger as orphaned rows.
    const comps=subjects.filter(s=>s.parent_subject_id===id);
    for (const c of comps) {
      await supabase.from("grades").delete().eq("subject_id",c.id);
      await supabase.from("subjects").delete().eq("id",c.id);
    }
    await supabase.from("grades").delete().eq("subject_id",id);
    await supabase.from("subjects").delete().eq("id",id);
    notify("🗑️ Subject deleted."); fetchAll();
  };

  const assignmentRowsFor=(subId)=>subjectAssignments.filter(a=>a.subject_id===subId);

  const toggleSubjectAssignment=async(subject,teacherId,sectionId)=>{
    if (!teacherId) return;
    setAssignmentBusy(true);
    const existing=subjectAssignments.find(a=>a.subject_id===subject.id&&a.teacher_id===teacherId&&((a.section_id||null)===(sectionId||null)));
    let error=null;
    if (existing) {
      ({error}=await supabase.from("subject_assignments").delete().eq("id",existing.id));
    } else {
      const result=await supabase.from("subject_assignments").insert({
        subject_id:subject.id,teacher_id:teacherId,section_id:sectionId||null
      });
      error=result.error;
      if (!error && !sectionId) {
        // Preserve legacy behavior for grade-wide subjects.
        await supabase.from("subjects").update({teacher_id:teacherId,section_id:null}).eq("id",subject.id);
      }
    }
    setAssignmentBusy(false);
    if (error){notify("❌ "+error.message);return;}
    notify(existing?"✅ Assignment removed.":"✅ Teacher assigned.");
    fetchAll();
  };

  const removeAllSubjectAssignments=async subject=>{
    if (!window.confirm(`Remove all teacher assignments for ${subject.name} (Grade ${subject.grade_level})?`)) return;
    const {error}=await supabase.from("subject_assignments").delete().eq("subject_id",subject.id);
    if (error){notify("❌ "+error.message);return;}
    await supabase.from("subjects").update({teacher_id:null}).eq("id",subject.id);
    notify("✅ All assignments removed."); fetchAll();
  };

  const ensureSubjectAssignments=async rows=>{
    // Do not use PostgREST upsert(onConflict:...) here. The migration uses
    // partial unique indexes for section-scoped and grade-wide rows, and
    // PostgREST cannot infer those indexes from (subject_id,teacher_id,section_id).
    // Check existing rows first, then insert only the missing assignments.
    if (!rows.length) return null;
    const subjectIds=[...new Set(rows.map(r=>r.subject_id))];
    const teacherIds=[...new Set(rows.map(r=>r.teacher_id))];
    const {data:existing,error:readError}=await supabase.from("subject_assignments")
      .select("id,subject_id,teacher_id,section_id")
      .in("subject_id",subjectIds).in("teacher_id",teacherIds);
    if (readError) return readError;
    const key=r=>`${r.subject_id}|${r.teacher_id}|${r.section_id||""}`;
    const existingKeys=new Set((existing||[]).map(key));
    const missing=rows.filter(r=>!existingKeys.has(key(r)));
    if (!missing.length) return null;
    const {error}=await supabase.from("subject_assignments").insert(missing);
    return error||null;
  };

  const copyGradeAssignments=async(subject,fromSectionId,toSectionIds,teacherId)=>{
    if (!teacherId||!toSectionIds.length) return;
    setAssignmentBusy(true);
    const rows=toSectionIds.map(sectionId=>({subject_id:subject.id,teacher_id:teacherId,section_id:sectionId}));
    const error=await ensureSubjectAssignments(rows);
    setAssignmentBusy(false);
    if (error){notify("❌ "+error.message);return;}
    notify(`✅ Assigned ${toSectionIds.length} section(s).`); fetchAll();
  };

  const reassignQualification=async(subId,qualName)=>{
    await supabase.from("subjects").update({tve_qualification:qualName||null}).eq("id",subId);
    notify("✅ TVE Qualification updated!"); fetchAll();
  };

  const reassignSubjectSection=async(subId,sectionId)=>{
    await supabase.from("subjects").update({section_id:sectionId||null}).eq("id",subId);
    notify("✅ Section scope updated!"); fetchAll();
  };

  const updateSubject=async updates=>{
    if (!editSubject) return;
    const {error}=await supabase.from("subjects").update(updates).eq("id",editSubject.id);
    if (error){notify("❌ "+error.message);return;}
    // Keep MAPEH components' grade level and TVE qualification scope in sync
    // with their parent, so "PE and Health" / "Music and Arts" never drift
    // onto a different roster than the MAPEH subject they belong to.
    const comps=subjects.filter(s=>s.parent_subject_id===editSubject.id);
    if (comps.length) {
      const compUpdates={};
      if (updates.grade_level!==undefined) compUpdates.grade_level=updates.grade_level;
      if (updates.tve_qualification!==undefined) compUpdates.tve_qualification=updates.tve_qualification;
      if (updates.curriculum!==undefined) compUpdates.curriculum=updates.curriculum;
      if (updates.shs_track!==undefined) compUpdates.shs_track=updates.shs_track;
      if (Object.keys(compUpdates).length) {
        await supabase.from("subjects").update(compUpdates).in("id",comps.map(c=>c.id));
      }
    }
    notify("✅ Subject updated!");
    setEditSubject(null);
    fetchAll();
  };

  // ── DepEd FORMS (SF2 / SF4) ──
  const [sf2Section,setSf2Section]=useState("");
  const [sf2Month,setSf2Month]=useState(null);
  const [sf4Level,setSf4Level]=useState("JHS");
  const [sf4Month,setSf4Month]=useState(null);
  const [genBusy,setGenBusy]=useState(false);
  const [sf4Incomplete,setSf4Incomplete]=useState(null); // null=not checked; [] = all encoded; [names] = gaps
  const [checkingSf4,setCheckingSf4]=useState(false);
  const [attendanceAudit,setAttendanceAudit]=useState(null);
  const [attendanceAuditBusy,setAttendanceAuditBusy]=useState(false);
  const runAttendanceAudit=async()=>{
    if(!sf2Section||!sf2Month){notify("⚠️ Select a section and month first.");return;}
    setAttendanceAuditBusy(true); setAttendanceAudit(null);
    const {data,error}=await supabase.rpc("agrians_attendance_audit",{
      p_section_id:sf2Section,p_month:sf2Month.month,p_year:sf2Month.year,p_term:sf2Month.term
    });
    setAttendanceAuditBusy(false);
    if(error){notify("❌ Attendance audit unavailable: "+error.message);return;}
    setAttendanceAudit(Array.isArray(data)?data[0]:data);
  };

  // Before generating SF4, quietly check which sections in scope haven't
  // saved a Daily Attendance grid for the selected month yet, so the admin
  // sees the gap up front instead of just a low/odd-looking percentage in
  // the PDF afterward (the PDF itself still marks these with a footnote).
  useEffect(()=>{
    if (!sf4Month) { setSf4Incomplete(null); return; }
    const grades = sf4Level==="JHS" ? [7,8,9,10] : [11,12];
    const days = schoolDaysInMonth(sf4Month, holidays);
    const scopedSections = sections.filter(s=>grades.includes(s.grade_level));
    const scopedStudents = students.filter(s=>grades.includes(s.grade_level) && s.section_id);
    if (!days.length || !scopedStudents.length) { setSf4Incomplete([]); return; }
    setCheckingSf4(true);
    (async()=>{
      const ids=scopedStudents.map(s=>s.id);
      const {data}=await supabase.from("daily_attendance").select("student_id")
        .in("student_id",ids).gte("date",days[0].date).lte("date",days[days.length-1].date)
        .limit(10000);
      const encodedStudentIds=new Set((data||[]).map(r=>r.student_id));
      const encodedSectionIds=new Set(
        scopedStudents.filter(s=>encodedStudentIds.has(s.id)).map(s=>s.section_id));
      const missing=scopedSections.filter(sec=>!encodedSectionIds.has(sec.id));
      setSf4Incomplete(missing.map(s=>`Gr.${s.grade_level} - ${s.name}`));
      setCheckingSf4(false);
    })();
  },[sf4Level,sf4Month,sections,students,holidays]);

  const downloadPdf=async(fnName,body,filename)=>{
    setGenBusy(true);
    notify("⏳ Generating "+filename+"...");
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData?.session?.access_token;
    try {
      const res=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
        {method:"POST",
         headers:{"Content-Type":"application/json","apikey":import.meta.env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`},
         body:JSON.stringify(body)});
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate "+filename}));
        notify("❌ "+(err.error||"Failed to generate "+filename));
        return;
      }
      const warningHeader=res.headers.get("X-Encoding-Warning");
      const genderWarningHeader=res.headers.get("X-Gender-Data-Warning");
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const warnings=[warningHeader,genderWarningHeader].filter(Boolean).map(decodeURIComponent);
      if (warnings.length) {
        // Longer-lived toast — this needs more than the default 3s to actually read.
        setToast("⚠️ Downloaded, but "+warnings.join(" | "));
        setTimeout(()=>setToast(""),8000);
      } else {
        notify("✅ Downloaded!");
      }
    } catch (e) {
      notify("❌ "+String(e.message||e));
    } finally {
      setGenBusy(false);
    }
  };

  const generateSF2Admin=()=>{
    if (!sf2Section||!sf2Month){notify("⚠️ Select a section and month first.");return;}
    const sec=sections.find(s=>s.id===sf2Section);
    downloadPdf("generate-sf2",
      {section_id:sf2Section,month:sf2Month.month,year:sf2Month.year,term:sf2Month.term},
      `SF2_${(sec?.name||"section").replace(/\s+/g,"_")}_${sf2Month.label.replace(/\s+/g,"_")}.pdf`);
  };

  const generateSF4=()=>{
    if (!sf4Month){notify("⚠️ Select a month first.");return;}
    downloadPdf("generate-sf4",
      {level:sf4Level,month:sf4Month.month,year:sf4Month.year,term:sf4Month.term},
      `SF4_${sf4Level}_${sf4Month.label.replace(/\s+/g,"_")}.pdf`);
  };

  // ── TVE QUALIFICATIONS ──
  // Admin-managed master list. This single list drives: (a) the qualification
  // a student is assigned (Students tab), and (b) the qualification a subject
  // is tagged with (Subjects tab) — keeping the two aligned.
  const addQualification=async()=>{
    const name=nQualification.trim();
    if (!name){notify("❌ Qualification name required.");return;}
    if (qualifications.some(q=>q.name.toLowerCase()===name.toLowerCase())){
      notify("❌ That qualification already exists.");return;
    }
    const {error}=await supabase.from("tve_qualifications").insert({name});
    if (error){notify("❌ "+error.message);return;}
    setNQualification("");
    notify("✅ TVE Qualification added!"); fetchAll();
  };

  const delQualification=async q=>{
    const inUseByStudents=students.filter(s=>s.tve_qualification===q.name).length;
    const inUseBySubjects=subjects.filter(s=>s.tve_qualification===q.name).length;
    if (inUseByStudents>0||inUseBySubjects>0){
      if (!window.confirm(
        `"${q.name}" is currently used by ${inUseByStudents} student(s) and ${inUseBySubjects} subject(s). `+
        `Deleting it will NOT change those records, but it will disappear from future dropdowns. Continue?`
      )) return;
    }
    const {error}=await supabase.from("tve_qualifications").delete().eq("id",q.id);
    if (error){notify("❌ "+error.message);return;}
    notify("🗑️ TVE Qualification deleted."); fetchAll();
  };

  // ── SECTIONS ──
  const addSection=async()=>{
    if (!nSection.name){notify("❌ Section name required.");return;}
    const {error}=await supabase.from("sections").insert({
      name:nSection.name,grade_level:parseInt(nSection.grade_level),adviser_id:nSection.adviser_id||null
    });
    if (error){notify("❌ "+error.message);return;}
    setNSection({name:"",grade_level:7,adviser_id:""});
    notify("✅ Section added!"); fetchAll();
  };

  const updateSection=async updates=>{
    if (!editSection) return;
    const {error}=await supabase.from("sections").update(updates).eq("id",editSection.id);
    if (error){notify("❌ "+error.message);return;}
    notify("✅ Section updated!");
    setEditSection(null);
    fetchAll();
  };

  const delSection=async id=>{
    await supabase.from("profiles").update({section_id:null}).eq("section_id",id);
    await supabase.from("sections").delete().eq("id",id);
    notify("🗑️ Section deleted."); fetchAll();
  };

  const reassignAdviser=async(secId,adviserId)=>{
    await supabase.from("sections").update({adviser_id:adviserId||null}).eq("id",secId);
    notify("✅ Adviser assigned!"); fetchAll();
  };

  // ── GRADES ──
  const saveGrade=async()=>{
    if (!nGrade.student_id||!nGrade.subject_id||!nGrade.grade){notify("❌ Fill all fields.");return;}
    const {error}=await supabase.from("grades").upsert({
      student_id:nGrade.student_id,subject_id:nGrade.subject_id,
      term:parseInt(nGrade.term),grade:parseFloat(nGrade.grade),encoded_by:profile.id
    },{onConflict:"student_id,subject_id,term"});
    if (error){notify("❌ "+error.message);return;}
    setNGrade({student_id:"",subject_id:"",term:1,grade:""});
    notify("✅ Grade saved!"); fetchAll();
  };

  const saveEditGrade=async()=>{
    const {error}=await supabase.from("grades")
      .update({grade:parseFloat(editGrade.grade)})
      .eq("student_id",editGrade.student_id).eq("subject_id",editGrade.subject_id).eq("term",editGrade.term);
    if (error){notify("❌ "+error.message);return;}
    setEditGrade(null); notify("✅ Grade updated!"); fetchAll();
  };

  const delGrade=async(studentId,subjectId,term)=>{
    await supabase.from("grades").delete()
      .eq("student_id",studentId).eq("subject_id",subjectId).eq("term",term);
    notify("🗑️ Grade deleted."); fetchAll();
  };

  const saveSchoolDays=async(month,year,term,days)=>{
    const {error}=await supabase.from("school_calendar")
      .upsert({month,year,term,school_days:parseInt(days)||0},{onConflict:"month,year,term"});
    if (error){notify("❌ "+error.message);return;}
    notify("✅ School days saved!"); fetchAll();
  };

  // ── APPOINTMENTS ──
  const updateApptStatus=async(id,status)=>{
    await supabase.from("appointments").update({status}).eq("id",id);
    notify(`✅ Appointment ${status}.`); fetchAll();
  };

  const delAppt=async id=>{
    await supabase.from("appointments").delete().eq("id",id);
    notify("🗑️ Appointment deleted."); fetchAll();
  };

  const stats=[
    {label:"Students",value:students.length,icon:"🎓",color:T.green2},
    {label:"Teachers",value:teachers.length,icon:"👨‍🏫",color:T.blue},
    {label:"Subjects",value:subjects.length,icon:"📚",color:T.yellowDark},
    {label:"Sections",value:sections.length,icon:"🏫",color:"#7b1fa2"},
  ];

  if (loading) return <Spinner/>;

  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <SchoolHeader small/>
      <TopBar name="Admin Panel" sub={profile.name} onLogout={onLogout}/>
      <Toast msg={toast}/>
      <div className="admin-welcome-wrap">
        <WelcomePanel profile={profile} role="admin" stats={[
          {icon:"🎓",value:students.length,label:"Learners"},
          {icon:"👨‍🏫",value:teachers.length,label:"Teachers"},
          {icon:"🏫",value:sections.length,label:"Sections"}
        ]}/>
      </div>

      {resetModal&&(
        <ResetPasswordModal user={resetModal}
          onConfirm={handleResetPassword} onClose={()=>setResetModal(null)}/>
      )}
      {editStudent&&(
        <EditStudentModal student={editStudent} sections={sections}
          qualifications={qualifications.map(q=>q.name)} canChangeGrade={true}
          onSave={handleUpdateStudent} onClose={()=>setEditStudent(null)}/>
      )}
      {editTeacher&&(
        <EditTeacherModal teacher={editTeacher}
          onSave={updateTeacher} onClose={()=>setEditTeacher(null)}/>
      )}
      {editSection&&(
        <EditSectionModal section={editSection}
          onSave={updateSection} onClose={()=>setEditSection(null)}/>
      )}
      {editSubject&&(
        <EditSubjectModal subject={editSubject}
          isMapeh={editSubject.name.trim().toUpperCase()==="MAPEH"}
          qualifications={qualifications.map(q=>q.name)}
          onSave={updateSubject} onClose={()=>setEditSubject(null)}/>
      )}
      {editGrade&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <Card className="dialog-sm">
            <div style={{fontSize:14,fontWeight:700,color:T.green1,marginBottom:12}}>✏️ Edit Grade</div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:8}}>
              {students.find(s=>s.id===editGrade.student_id)?.name} ·{" "}
              {subjects.find(s=>s.id===editGrade.subject_id)?.name} · Term {editGrade.term}
            </div>
            <input type="number" min="0" max="100" value={editGrade.grade}
              onChange={e=>setEditGrade(p=>({...p,grade:e.target.value}))} style={{marginBottom:12}}/>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={saveEditGrade} style={{flex:1}}>💾 Save</Btn>
              <Btn onClick={()=>setEditGrade(null)} color="#e0e0e0" style={{flex:1,color:T.text}}>Cancel</Btn>
            </div>
          </Card>
        </div>
      )}

      <div className="dashboard-scroll">
        <div className="dashboard-inner">
          <div key={tab} className="tab-scene">

        {tab==="overview"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:12}}>
              🏫 Overview — S.Y. 2026–2027
            </div>
            <div className="kpi-grid">
              {stats.map(s=>(
                <Card key={s.label} className="kpi-card">
                  <div className="kpi-icon" style={{background:`${s.color}18`}}>{s.icon}</div>
                  <div><div className="kpi-value" style={{color:s.color}}>{s.value}</div>
                  <div className="kpi-label">{s.label}</div></div>
                </Card>
              ))}
            </div>

            <div className="insight-grid admin-insights">
              <Card className="insight-card">
                <div className="insight-kicker">ENROLLMENT DISTRIBUTION</div>
                <MiniBarChart
                  data={GRADE_LEVELS.map(g=>({label:`G${g}`,value:students.filter(s=>s.grade_level===g).length}))}
                  label="Learners per grade level"
                />
              </Card>
              <Card className="insight-card">
                <div className="insight-kicker">SCHOOL STRUCTURE</div>
                <div className="structure-list">
                  <div><span>Sections</span><strong>{sections.length}</strong></div>
                  <div><span>Teachers</span><strong>{teachers.length}</strong></div>
                  <div><span>Subjects</span><strong>{subjects.filter(s=>!s.parent_subject_id).length}</strong></div>
                  <div><span>Pending appointments</span><strong>{appointments.filter(a=>a.status==="Pending").length}</strong></div>
                </div>
              </Card>
            </div>

            <div style={{fontSize:14,fontWeight:700,color:T.green1,margin:"18px 0 10px"}}>
              📈 Grade Encoding Progress
            </div>
            {sections.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:16}}>No sections yet.</div></Card>
              :GRADE_LEVELS.map(gl=>{
                const glSections=sections.filter(s=>s.grade_level===gl);
                if (!glSections.length) return null;
                return (
                  <div key={gl} style={{marginBottom:12}}>
                    <div style={{fontSize:12,fontWeight:800,color:T.white,background:T.green1,
                      padding:"6px 12px",borderRadius:8,marginBottom:8}}>
                      Grade {gl}
                    </div>
                    {glSections.map(sec=>(
                      <EncodingProgressCard key={sec.id}
                        result={computeSectionEncoding(sec,subjects,students,grades)}/>
                    ))}
                  </div>
                );
              })
            }

            <Card style={{padding:12}}>
              <div style={{display:"flex",height:8,borderRadius:6,overflow:"hidden",marginBottom:8}}>
                <div style={{flex:1,background:T.blue}}/><div style={{flex:1,background:T.red}}/>
                <div style={{flex:1,background:T.yellow}}/>
              </div>
              <div style={{fontSize:12,color:T.textMuted,textAlign:"center",fontWeight:600}}>
                Department of Education · Region XI · Division of Davao City
              </div>
            </Card>
          </div>
        )}

        {tab==="statistics"&&(<AdminSchoolStatistics students={students} teachers={teachers} subjects={subjects} subjectAssignments={subjectAssignments} grades={grades} sections={sections}/>)}

        {tab==="settings"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:12}}>
              ⚙️ System Settings
            </div>

            {/* Lock/Unlock */}
            <Card style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
                🔒 Student Access Control
              </div>
              <div style={{fontSize:12,color:T.textMuted,marginBottom:12,lineHeight:1.7}}>
                When locked, students cannot log in. Teachers and Admin are not affected.
                Current status:{" "}
                <strong style={{color:isLocked?T.red:T.green4}}>
                  {isLocked?"🔒 LOCKED":"🔓 UNLOCKED"}
                </strong>
              </div>
              <Btn
                onClick={toggleLock}
                color={isLocked?T.green3:T.red}
                style={{width:"100%",fontSize:14}}>
                {isLocked?"🔓 Unlock Student Access":"🔒 Lock Student Access"}
              </Btn>
            </Card>

            {/* Generic Password */}
            <Card>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
                🔑 Set Generic Password for All Students
              </div>
              <div style={{fontSize:12,color:T.textMuted,marginBottom:12,lineHeight:1.7}}>
                This will reset the password of ALL {students.length} students to the same password.
                Students can use this to log in then change it later.
              </div>
              <div style={{position:"relative",marginBottom:8}}>
                <input
                  type={showGenericPass?"text":"password"}
                  value={genericPass}
                  onChange={e=>setGenericPass(e.target.value)}
                  placeholder="Enter generic password (min 6 characters)"
                  style={{paddingRight:44}}/>
                <button onClick={()=>setShowGenericPass(p=>!p)} style={{
                  position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
                  background:"none",border:"none",cursor:"pointer",fontSize:16,color:T.textMuted}}>
                  {showGenericPass?"🙈":"👁️"}
                </button>
              </div>
              {/* Strength bar */}
              {genericPass.length>0&&(()=>{
                const s=genericPass.length<6?1:genericPass.length<9?2:genericPass.length<12?3:4;
                const sc=[T.gray,T.red,"#ff9800",T.yellow,T.green4][s];
                const sl=["","Too short","Weak","Good","Strong"][s];
                return (
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
                    {[1,2,3,4].map(i=>(
                      <div key={i} style={{flex:1,height:4,borderRadius:2,
                        background:s>=i?sc:"#e0e0e0",transition:"background .2s"}}/>
                    ))}
                    <span style={{fontSize:11,color:sc,flexShrink:0}}>{sl}</span>
                  </div>
                );
              })()}
              <Btn
                onClick={applyGenericPassword}
                disabled={applyingPass||genericPass.length<6}
                color={T.blue}
                style={{width:"100%",fontSize:13}}>
                {applyingPass
                  ?`⏳ Applying to all ${students.length} students...`
                  :`🔑 Apply to All ${students.length} Students`}
              </Btn>
              {applyingPass&&(
                <div style={{fontSize:11,color:T.textMuted,textAlign:"center",marginTop:8}}>
                  Please wait. Do not close this page.
                </div>
              )}
            </Card>

            {/* TVE Qualifications */}
            <Card style={{marginTop:14}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
                🎯 TVE Qualifications
              </div>
              <div style={{fontSize:12,color:T.textMuted,marginBottom:12,lineHeight:1.7}}>
                These are the official TVE qualification names for Grades 8–10. They drive the
                qualification a student is assigned (Students tab) and the qualification a subject
                can be tagged with (Subjects tab) — keeping the two aligned. Each section's student
                list and each TVE subject teacher's class list are filtered using these names.
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <input placeholder="e.g. AgriCrop Production" value={nQualification}
                  onChange={e=>setNQualification(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addQualification()}/>
                <Btn onClick={addQualification} style={{flexShrink:0,padding:"10px 16px"}}>➕ Add</Btn>
              </div>
              {qualifications.length===0
                ?<div style={{textAlign:"center",color:T.gray,padding:14,fontSize:12}}>
                    No TVE qualifications defined yet. Add one above.
                  </div>
                :qualifications.map(q=>{
                  const studentCount=students.filter(s=>s.tve_qualification===q.name).length;
                  const subjectCount=subjects.filter(s=>s.tve_qualification===q.name).length;
                  return (
                    <div key={q.id} style={{display:"flex",justifyContent:"space-between",
                      alignItems:"center",padding:"8px 10px",background:T.bgPanel,
                      borderRadius:8,marginBottom:6}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:T.text}}>{q.name}</div>
                        <div style={{fontSize:10,color:T.textMuted}}>
                          {studentCount} student{studentCount!==1?"s":""} · {subjectCount} subject{subjectCount!==1?"s":""}
                        </div>
                      </div>
                      <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                        onClick={()=>delQualification(q)}>🗑️</Btn>
                    </div>
                  );
                })
              }
            </Card>
          </div>
        )}

        {tab==="students"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>🎓 Manage Students</div>
            <AddStudentForm sections={sections} onAdd={handleAddStudent} loading={addingStudent}
              qualifications={qualifications.map(q=>q.name)}/>
            <StudentListGrouped students={students} sections={sections} teachers={teachers}
              showActions={true} onDelete={delStudent}
              onReset={u=>setResetModal(u)} onReassign={reassignSection}
              onEdit={s=>setEditStudent(s)}
              qualifications={qualifications.map(q=>q.name)}/>
          </div>
        )}

        {tab==="teachers"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>👨‍🏫 Manage Teachers</div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Teacher</div>
              <div style={{display:"grid",gap:8,marginBottom:8}}>
                <input placeholder="Full Name *" value={nTeacher.name}
                  onChange={e=>setNTeacher(p=>({...p,name:e.target.value}))}/>
                <input placeholder="Email *" value={nTeacher.email}
                  onChange={e=>setNTeacher(p=>({...p,email:e.target.value}))}/>
                <input type="password" placeholder="Password *" value={nTeacher.password}
                  onChange={e=>setNTeacher(p=>({...p,password:e.target.value}))}/>
              </div>
              <Btn onClick={addTeacher} style={{width:"100%"}}>➕ Add Teacher</Btn>
            </Card>
            {teachers.map(t=>(
              <Card key={t.id} style={{marginBottom:8,padding:"10px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:13,color:T.text}}>{t.name}</div>
                    <div style={{fontSize:11,color:T.textMuted}}>{t.email}</div>
                    <div style={{fontSize:11,color:T.textMuted}}>
                      {(()=>{
                      const names=new Set([
                        ...subjects.filter(s=>s.teacher_id===t.id).map(s=>s.name),
                        ...subjectAssignments.filter(a=>a.teacher_id===t.id).map(a=>subjects.find(s=>s.id===a.subject_id)?.name).filter(Boolean)
                      ]);
                      return Array.from(names).join(", ")||"No subjects";
                    })()}
                    </div>
                    {t.is_curriculum_head&&(
                      <Badge text={`Curriculum Head Gr.${t.assigned_grade_level}`} color={T.green2}/>
                    )}
                    {sections.find(s=>s.adviser_id===t.id)&&(
                      <Badge text={`Adviser: ${sections.find(s=>s.adviser_id===t.id)?.name}`} color="#7b1fa2"/>
                    )}
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <Btn color={T.green3} style={{padding:"5px 8px",fontSize:11}}
                      onClick={()=>setEditTeacher(t)}>✏️</Btn>
                    <Btn color={T.blue} style={{padding:"5px 8px",fontSize:11}}
                      onClick={()=>setResetModal({userId:t.id,name:t.name,role:"teacher"})}>🔑</Btn>
                    <Btn color={T.red} style={{padding:"5px 8px",fontSize:11}}
                      onClick={()=>delTeacher(t.id)}>🗑️</Btn>
                  </div>
                </div>
                <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #E3EEDD"}}>
                  <div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Curriculum Head:</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {GRADE_LEVELS.map(gl=>(
                      <button key={gl} onClick={()=>toggleCurriculumHead(t,gl)} style={{
                        padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                        border:"none",cursor:"pointer",
                        background:t.is_curriculum_head&&t.assigned_grade_level===gl?T.green3:T.bgPanel,
                        color:t.is_curriculum_head&&t.assigned_grade_level===gl?T.white:T.textMuted}}>
                        Gr.{gl}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab==="sections"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>🏫 Manage Sections</div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Section</div>
              <div style={{display:"grid",gap:8,marginBottom:8}}>
                <input placeholder="Section Name * e.g. Sampaguita" value={nSection.name}
                  onChange={e=>setNSection(p=>({...p,name:e.target.value}))}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <select value={nSection.grade_level}
                    onChange={e=>setNSection(p=>({...p,grade_level:e.target.value}))}>
                    {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={nSection.adviser_id}
                    onChange={e=>setNSection(p=>({...p,adviser_id:e.target.value}))}>
                    <option value="">-- Adviser (opt) --</option>
                    {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <Btn onClick={addSection} style={{width:"100%"}}>➕ Add Section</Btn>
            </Card>
            {GRADE_LEVELS.map(gl=>{
              const glSecs=sections.filter(s=>s.grade_level===gl);
              if (!glSecs.length) return null;
              return (
                <div key={gl} style={{marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.white,background:T.green1,
                    padding:"4px 10px",borderRadius:6,marginBottom:6}}>Grade {gl}</div>
                  {glSecs.map(sec=>{
                    const adviser=teachers.find(t=>t.id===sec.adviser_id);
                    const secStudents=students.filter(s=>s.section_id===sec.id);
                    const count=secStudents.length;
                    const isTveGrade=gl>=8&&gl<=10;
                    const qualBreakdown=isTveGrade
                      ?qualifications.map(q=>({
                          name:q.name,
                          count:secStudents.filter(s=>s.tve_qualification===q.name).length,
                        })).filter(g=>g.count>0)
                      :[];
                    const unassignedCount=isTveGrade
                      ?secStudents.filter(s=>!s.tve_qualification||
                          !qualifications.some(q=>q.name===s.tve_qualification)).length
                      :0;
                    return (
                      <Card key={sec.id} style={{marginBottom:6,padding:"10px 12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",marginBottom:6}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:13,color:T.text}}>{sec.name}</div>
                            <div style={{fontSize:11,color:T.textMuted}}>{count} students</div>
                          </div>
                          <div style={{display:"flex",gap:4}}>
                            <Btn color={T.green3} style={{padding:"5px 10px",fontSize:11}}
                              onClick={()=>setEditSection(sec)}>✏️</Btn>
                            <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                              onClick={()=>delSection(sec.id)}>🗑️</Btn>
                          </div>
                        </div>
                        {isTveGrade&&(
                          <div style={{marginBottom:8,padding:"6px 8px",background:"#f3e5f5",
                            borderRadius:6}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#7b1fa2",marginBottom:4}}>
                              🎯 By TVE Qualification
                            </div>
                            {qualBreakdown.length===0&&unassignedCount===0
                              ?<div style={{fontSize:10,color:T.gray}}>No students yet.</div>
                              :(
                                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                  {qualBreakdown.map(g=>(
                                    <span key={g.name} style={{fontSize:10,color:T.text,
                                      background:"#fff",borderRadius:10,padding:"2px 8px",
                                      border:"1px solid #d8b8d8"}}>
                                      {g.name}: <strong>{g.count}</strong>
                                    </span>
                                  ))}
                                  {unassignedCount>0&&(
                                    <span style={{fontSize:10,color:T.red,background:"#fff",
                                      borderRadius:10,padding:"2px 8px",border:"1px solid #f0c0c0"}}>
                                      Unassigned: <strong>{unassignedCount}</strong>
                                    </span>
                                  )}
                                </div>
                              )}
                          </div>
                        )}
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{fontSize:11,color:T.textMuted,flexShrink:0}}>Adviser:</div>
                          <select value={sec.adviser_id||""}
                            onChange={e=>reassignAdviser(sec.id,e.target.value)}
                            style={{fontSize:12,padding:"5px 8px"}}>
                            <option value="">-- Unassigned --</option>
                            {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {tab==="subjects"&&(
          <div>
            <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:6}}>📚 Subjects & Teaching Assignments</div>
            <div style={{fontSize:12,color:T.textMuted,marginBottom:12,lineHeight:1.6}}>
              Assign by <strong>Subject + Section + Teacher</strong>. One subject can now have many teachers,
              and each teacher can be assigned to different sections without creating duplicate subject records.
            </div>

            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Subject</div>
              <div style={{display:"grid",gap:8,marginBottom:8}}>
                <input placeholder="Subject Name * e.g. Mathematics" value={nSubject.name}
                  onChange={e=>setNSubject(p=>({...p,name:e.target.value}))}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <select value={nSubject.grade_level}
                    onChange={e=>setNSubject(p=>({...p,grade_level:e.target.value,tve_qualification:""}))}>
                    {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={nSubject.section_id}
                    onChange={e=>setNSubject(p=>({...p,section_id:e.target.value}))}>
                    <option value="">-- All sections in grade --</option>
                    {sections.filter(s=>s.grade_level===parseInt(nSubject.grade_level)).map(s=>
                      <option key={s.id} value={s.id}>{s.name} only</option>)}
                  </select>
                </div>
                {parseInt(nSubject.grade_level)>=8&&parseInt(nSubject.grade_level)<=10&&(
                  <select value={nSubject.tve_qualification}
                    onChange={e=>setNSubject(p=>({...p,tve_qualification:e.target.value}))}>
                    <option value="">-- TVE Qualification (opt) --</option>
                    {qualifications.map(q=><option key={q.name} value={q.name}>{q.name}</option>)}
                  </select>
                )}
                {(parseInt(nSubject.grade_level)===11||parseInt(nSubject.grade_level)===12)&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <select value={nSubject.term}
                      onChange={e=>setNSubject(p=>({...p,term:e.target.value}))}>
                      <option value="">-- All terms (default) --</option>
                      <option value="1">Term 1 only</option>
                      <option value="2">Term 2 only</option>
                      <option value="3">Term 3 only</option>
                    </select>
                    <select value={nSubject.curriculum}
                      onChange={e=>setNSubject(p=>({...p,curriculum:e.target.value,shs_track:""}))}>
                      <option value="regular">Curriculum: Regular</option>
                      <option value="als">Curriculum: ALS</option>
                    </select>
                    {nSubject.curriculum!=="als"&&(
                      <select value={nSubject.shs_track} style={{gridColumn:"1 / -1"}}
                        onChange={e=>setNSubject(p=>({...p,shs_track:e.target.value}))}>
                        <option value="">-- All tracks (default) --</option>
                        {(parseInt(nSubject.grade_level)===11?GRADE11_TRACKS:GRADE12_TRACKS)
                          .map(t=><option key={t} value={t}>{t} only</option>)}
                      </select>
                    )}
                  </div>
                )}
                <select value={nSubject.teacher_id}
                  onChange={e=>setNSubject(p=>({...p,teacher_id:e.target.value}))}>
                  <option value="">-- Assign Teacher (opt) --</option>
                  {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {nSubject.name.trim().toUpperCase()==="MAPEH"&&(
                  <div style={{fontSize:10,color:T.textMuted,padding:"6px 8px",background:"#f3e5f5",borderRadius:6}}>
                    🧩 MAPEH is never graded directly — "PE and Health" and "Music and Arts"
                    components will be created automatically underneath it.
                  </div>
                )}
              </div>
              <Btn onClick={addSubject} style={{width:"100%"}}>➕ Add Subject</Btn>
            </Card>

            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>📋 All Subjects</div>
              {GRADE_LEVELS.map(gl=>{
                const glSubs=subjects.filter(s=>s.grade_level===gl&&!s.parent_subject_id);
                if (!glSubs.length) return null;
                return (
                  <div key={gl} style={{marginBottom:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.white,background:T.green1,
                      padding:"4px 10px",borderRadius:6,marginBottom:6}}>Grade {gl}</div>
                    {glSubs.map(sub=>{
                      const sec=sections.find(s=>s.id===sub.section_id);
                      const assignedCount=assignmentRowsFor(sub.id).length;
                      const glSections=sections.filter(s=>s.grade_level===gl);
                      return (
                        <div key={sub.id} style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",padding:"8px 4px",borderBottom:"1px solid #f0f0f0",gap:8,flexWrap:"wrap"}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:12,color:T.text}}>{sub.name}</div>
                            <div style={{fontSize:10,color:T.textMuted}}>
                              {sec?sec.name:"All sections"}
                              {sub.tve_qualification?` · ${sub.tve_qualification}`:""}
                              {sub.shs_track?` · ${sub.shs_track} only`:""}
                              {sub.curriculum==="als"?" · ALS":""}
                              {" · "}{assignedCount} teacher{assignedCount===1?"":"s"} assigned
                            </div>
                          </div>
                          <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
                            {glSections.length>1&&(
                              <select value={sub.section_id||""} style={{fontSize:11,padding:"4px 6px"}}
                                onChange={e=>{
                                  const newSec=e.target.value;
                                  const label=newSec?sections.find(s=>s.id===newSec)?.name:"All sections";
                                  if (window.confirm(`Move "${sub.name}" to "${label}"? Existing grades stay attached to this subject — this only changes which section(s) see it.`)) {
                                    reassignSubjectSection(sub.id,newSec);
                                  }
                                }}>
                                <option value="">-- All sections --</option>
                                {glSections.map(s=><option key={s.id} value={s.id}>{s.name} only</option>)}
                              </select>
                            )}
                            <Btn color={T.green3} style={{padding:"5px 10px",fontSize:11}}
                              onClick={()=>setEditSubject(sub)}>✏️</Btn>
                            <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                              onClick={()=>{
                                if (window.confirm(`Delete "${sub.name}" (Grade ${sub.grade_level})? This also deletes every recorded grade for this subject${sub.name.trim().toUpperCase()==="MAPEH"?" and its PE and Health / Music and Arts components":""}. This cannot be undone.`)) delSubject(sub.id);
                              }}>🗑️</Btn>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {subjects.filter(s=>!s.parent_subject_id).length===0&&(
                <div style={{padding:16,textAlign:"center",color:T.gray,fontSize:12}}>No subjects yet. Add one above.</div>
              )}
            </Card>

            <Card style={{marginBottom:12,padding:10}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
                <div>
                  <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",marginBottom:4}}>GRADE</label>
                  <select value={assignmentGrade} onChange={e=>setAssignmentGrade(parseInt(e.target.value))}>
                    {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",marginBottom:4}}>TEACHER</label>
                  <select value={assignmentTeacherFilter} onChange={e=>setAssignmentTeacherFilter(e.target.value)}>
                    <option value="">All teachers</option>
                    {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontWeight:800,color:T.textMuted,display:"block",marginBottom:4}}>SEARCH SUBJECT</label>
                  <input value={assignmentSearch} onChange={e=>setAssignmentSearch(e.target.value)} placeholder="e.g. Mathematics"/>
                </div>
              </div>
            </Card>

            <Card style={{padding:0,overflow:"hidden",marginBottom:12}}>
              <div style={{padding:"10px 12px",background:T.green1,color:T.white,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                <div>
                  <div style={{fontWeight:800,fontSize:13}}>Grade {assignmentGrade} Assignment Matrix</div>
                  <div style={{fontSize:10,opacity:.82}}>Tap a cell to assign or remove a teacher.</div>
                </div>
                <div style={{fontSize:11,fontWeight:700}}>{sections.filter(s=>s.grade_level===assignmentGrade).length} sections</div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",minWidth:760,borderCollapse:"separate",borderSpacing:0}}>
                  <thead>
                    <tr>
                      <th style={{position:"sticky",left:0,zIndex:3,background:T.bgPanel,textAlign:"left",padding:"8px 10px",fontSize:10,color:T.textMuted,borderBottom:"1px solid #dbe5d8"}}>SUBJECT</th>
                      {sections.filter(sec=>sec.grade_level===assignmentGrade).map(sec=><th key={sec.id} style={{padding:"8px 7px",fontSize:10,color:T.textMuted,borderBottom:"1px solid #dbe5d8",whiteSpace:"nowrap"}}>{sec.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.filter(sub=>sub.grade_level===assignmentGrade&&!sub.parent_subject_id&&sub.name.toLowerCase().includes(assignmentSearch.toLowerCase())).map(sub=>{
                      const secList=sections.filter(sec=>sec.grade_level===assignmentGrade);
                      return (
                        <tr key={sub.id}>
                          <td style={{position:"sticky",left:0,zIndex:2,background:T.white,padding:"9px 10px",borderBottom:"1px solid #edf1eb",minWidth:170}}>
                            <div style={{fontWeight:800,fontSize:12,color:T.text}}>{sub.name}</div>
                            {sub.tve_qualification&&<div style={{fontSize:9,color:"#7b1fa2",marginTop:2}}>{sub.tve_qualification}</div>}
                            <button disabled={assignmentBusy} onClick={()=>removeAllSubjectAssignments(sub)} style={{border:0,background:"none",color:T.red,fontSize:9,fontWeight:700,padding:"3px 0",cursor:"pointer"}}>Clear all</button>
                          </td>
                          {secList.map(sec=>{
                            const allRows=assignmentRowsFor(sub.id).filter(a=>a.section_id===sec.id || !a.section_id);
                            const rows=allRows.filter(a=>!assignmentTeacherFilter||a.teacher_id===assignmentTeacherFilter);
                            return (
                              <td key={sec.id} style={{padding:5,borderBottom:"1px solid #edf1eb",verticalAlign:"top",minWidth:125}}>
                                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                  {rows.map(a=>{
                                    const teacher=teachers.find(t=>t.id===a.teacher_id);
                                    return <button key={a.id} disabled={assignmentBusy} onClick={()=>toggleSubjectAssignment(sub,a.teacher_id,a.section_id||null)} title="Remove assignment" style={{textAlign:"left",border:"1px solid #cfe0d0",background:assignmentTeacherFilter===a.teacher_id?"#dff2e3":"#f7fbf7",borderRadius:7,padding:"5px 6px",cursor:"pointer",fontSize:10,color:T.text,fontWeight:700}}>{teacher?.name||"Unknown"}<span style={{display:"block",fontSize:8,color:T.textMuted,fontWeight:500}}>{a.section_id?"section assignment":"all sections"} · tap to remove</span></button>;
                                  })}
                                  <select disabled={assignmentBusy} value="" onChange={e=>{if(e.target.value)toggleSubjectAssignment(sub,e.target.value,sec.id);}} style={{fontSize:10,padding:"6px 5px",borderStyle:"dashed",color:T.green2,fontWeight:800,background:"transparent"}}>
                                    <option value="">＋ Assign teacher</option>
                                    {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                                  </select>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {subjects.filter(sub=>sub.grade_level===assignmentGrade&&!sub.parent_subject_id&&sub.name.toLowerCase().includes(assignmentSearch.toLowerCase())).length===0&&(
                <div style={{padding:20,textAlign:"center",color:T.gray,fontSize:12}}>No subjects match this grade/search.</div>
              )}
            </Card>

            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:800,color:T.green2,marginBottom:5}}>⚡ Quick assignment</div>
              <div style={{fontSize:11,color:T.textMuted,marginBottom:9}}>Use this when one teacher handles the same subject for several sections.</div>
              <QuickAssignmentForm
                subjects={subjects.filter(s=>s.grade_level===assignmentGrade&&!s.parent_subject_id)}
                sections={sections.filter(s=>s.grade_level===assignmentGrade)}
                teachers={teachers}
                onAssign={async({subjectId,teacherId,sectionIds,allSections})=>{
                  const sub=subjects.find(s=>s.id===subjectId);
                  if (!sub) return;
                  if (allSections) {
                    setAssignmentBusy(true);
                    const error=await ensureSubjectAssignments([{subject_id:sub.id,teacher_id:teacherId,section_id:null}]);
                    setAssignmentBusy(false);
                    if (error) notify("❌ "+error.message); else { notify("✅ Teacher assigned to all sections in this grade."); fetchAll(); }
                  } else await copyGradeAssignments(sub,null,sectionIds,teacherId);
                }}
                busy={assignmentBusy}
              />
            </Card>

            <div style={{fontSize:13,fontWeight:800,color:T.green1,margin:"14px 0 8px"}}>📋 Assignment summary</div>
            {teachers.filter(t=>!assignmentTeacherFilter||t.id===assignmentTeacherFilter).map(t=>{
              const rows=subjectAssignments.filter(a=>a.teacher_id===t.id);
              if (!rows.length) return null;
              return <Card key={t.id} style={{marginBottom:7,padding:"9px 11px"}}>
                <div style={{fontWeight:800,fontSize:12,color:T.text}}>{t.name}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:5}}>
                  {rows.map(a=>{
                    const sub=subjects.find(s=>s.id===a.subject_id),sec=sections.find(s=>s.id===a.section_id);
                    if (!sub||sub.grade_level!==assignmentGrade) return null;
                    return <span key={a.id} style={{fontSize:9,padding:"4px 7px",borderRadius:999,background:T.bgPanel,color:T.text}}>{sub.name} · {sec?.name||`All Gr.${sub.grade_level}`}</span>;
                  })}
                </div>
              </Card>;
            })}

            <Card style={{marginTop:12,padding:10,background:"#fffaf0",border:"1px solid #f4dfae"}}>
              <div style={{fontSize:11,fontWeight:800,color:T.yellowDark,marginBottom:3}}>💡 How AGRIANS now thinks about teaching load</div>
              <div style={{fontSize:10,color:T.textMuted,lineHeight:1.6}}>
                One subject is created once. Teachers are assigned to the sections they actually handle.
                This means Mathematics can have Teacher A in Section A, Teacher B in Section B, and Teacher A again in Section C — without duplicate subject records.
              </div>
            </Card>
          </div>
        )}

        {tab==="grades"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📝 Manage Grades</div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>
                ➕ Add / Update Grade
              </div>
              <div style={{display:"grid",gap:8,marginBottom:8}}>
                <select value={nGrade.student_id}
                  onChange={e=>setNGrade(p=>({...p,student_id:e.target.value}))}>
                  <option value="">-- Select Student --</option>
                  {students.map(s=><option key={s.id} value={s.id}>{studentDisplay(s)} (LRN: {s.lrn})</option>)}
                </select>
                <select value={nGrade.subject_id}
                  onChange={e=>setNGrade(p=>({...p,subject_id:e.target.value}))}>
                  <option value="">-- Select Subject --</option>
                  {subjects.filter(s=>!isMapehParent(s,subjects)).map(s=><option key={s.id} value={s.id}>
                    {s.name}{s.parent_subject_id?" (MAPEH component)":""} (Gr.{s.grade_level}{s.tve_qualification?` · ${s.tve_qualification}`:""})
                  </option>)}
                </select>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <select value={nGrade.term} onChange={e=>setNGrade(p=>({...p,term:e.target.value}))}>
                    <option value={1}>Term 1</option><option value={2}>Term 2</option>
                    <option value={3}>Term 3</option>
                  </select>
                  <input type="number" min="0" max="100" placeholder="Grade *"
                    value={nGrade.grade} onChange={e=>setNGrade(p=>({...p,grade:e.target.value}))}/>
                </div>
              </div>
              <Btn onClick={saveGrade} style={{width:"100%"}}>💾 Save Grade</Btn>
            </Card>
            {grades.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:16}}>No grades yet.</div></Card>
              :grades.map(g=>{
                const stu=students.find(s=>s.id===g.student_id);
                const sub=subjects.find(s=>s.id===g.subject_id);
                if (!stu||!sub) return null;
                return (
                  <Card key={`${g.student_id}-${g.subject_id}-${g.term}`}
                    style={{marginBottom:6,padding:"8px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:T.text}}>{stu.name}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>{sub.name} · Term {g.term}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:18,fontWeight:900,color:remark(g.grade).c}}>{g.grade}</span>
                        <Btn color={T.blue} style={{padding:"5px 8px",fontSize:11}}
                          onClick={()=>setEditGrade({...g})}>✏️</Btn>
                        <Btn color={T.red} style={{padding:"5px 8px",fontSize:11}}
                          onClick={()=>delGrade(g.student_id,g.subject_id,g.term)}>🗑️</Btn>
                      </div>
                    </div>
                  </Card>
                );
              })
            }
          </div>
        )}

        {tab==="calendar"&&(
          <CalendarPanel calendar={calendar} onSave={saveSchoolDays}
            holidays={holidays} onAddHoliday={addHoliday} onDeleteHoliday={deleteHoliday}/>
        )}

        {tab==="forms"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📄 DepEd Forms</div>

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
              School Form 2 — Daily Attendance Report (per section)
            </div>
            <Card style={{marginBottom:16}}>
              <div style={{display:"grid",gap:8}}>
                <select value={sf2Section} onChange={e=>setSf2Section(e.target.value)}>
                  <option value="">-- Select Section --</option>
                  {sections.map(s=><option key={s.id} value={s.id}>Gr.{s.grade_level} — {s.name}</option>)}
                </select>
                <select value={sf2Month?`${sf2Month.month}-${sf2Month.year}-${sf2Month.term}`:""}
                  onChange={e=>{
                    if (!e.target.value){setSf2Month(null);return;}
                    const [m,y,t]=e.target.value.split("-");
                    setSf2Month(TERM_MONTHS.find(x=>x.month===parseInt(m)&&x.year===parseInt(y)&&x.term===parseInt(t))||null);
                  }}>
                  <option value="">-- Select Month --</option>
                  {TERM_MONTHS.map((m,i)=><option key={i} value={`${m.month}-${m.year}-${m.term}`}>{m.label}</option>)}
                </select>
                <Btn onClick={generateSF2Admin} disabled={genBusy}>📄 Generate SF2 PDF</Btn>
              </div>
            </Card>

            <Card style={{marginBottom:16,background:"#f4fbf1",border:"1px solid #cfe3c8"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:6}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:T.green2}}>🔎 Attendance Audit Pass</div>
                  <div style={{fontSize:10.5,color:T.textMuted}}>Reconcile Calendar → Daily Attendance → learner totals before generating reports.</div>
                </div>
                <Btn onClick={runAttendanceAudit} disabled={attendanceAuditBusy||!sf2Section||!sf2Month} style={{whiteSpace:"nowrap"}}>
                  {attendanceAuditBusy?"⏳ Auditing…":"Run Audit"}
                </Btn>
              </div>
              {attendanceAudit&&<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6,marginTop:8}}>
                {[
                  ["Calendar",attendanceAudit.calendar_agrees?"PASS":"MISMATCH"],
                  ["School days",`${attendanceAudit.actual_days} (configured ${attendanceAudit.configured_days??"—"})`],
                  ["Roster",attendanceAudit.roster_count],
                  ["Encoded learners",`${attendanceAudit.encoded_student_count}/${attendanceAudit.roster_count}`],
                  ["Rows in school-day grid",attendanceAudit.daily_rows_in_grid],
                  ["Rows outside grid",attendanceAudit.daily_rows_outside_grid],
                  ["Duplicate student/date",attendanceAudit.duplicate_student_date_count],
                  ["Impossible totals",attendanceAudit.impossible_summary_count]
                ].map(([label,value])=><div key={label} style={{padding:"7px 9px",background:"#fff",borderRadius:7,border:"1px solid #e1eadf",fontSize:10.5}}>
                  <div style={{color:T.textMuted}}>{label}</div><strong style={{color:(label==="Calendar"&&value!=="PASS")||((label==="Rows outside grid"||label==="Duplicate student/date"||label==="Impossible totals")&&Number(value)>0)?T.red:T.green3}}>{value}</strong>
                </div>)}
              </div>}
            </Card>

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
              School Form 4 — Monthly Learner's Movement & Attendance
            </div>
            <Card style={{marginBottom:12}}>
              <div style={{display:"grid",gap:8}}>
                <div style={{display:"flex",gap:8}}>
                  {["JHS","SHS"].map(lv=>(
                    <button key={lv} onClick={()=>setSf4Level(lv)}
                      style={{flex:1,padding:"10px 0",borderRadius:8,fontSize:13,fontWeight:700,
                        background:sf4Level===lv?T.green3:"#EEF6EC",color:sf4Level===lv?T.white:T.textMuted}}>
                      {lv==="JHS"?"Junior High (7–10)":"Senior High (11–12)"}
                    </button>
                  ))}
                </div>
                <select value={sf4Month?`${sf4Month.month}-${sf4Month.year}-${sf4Month.term}`:""}
                  onChange={e=>{
                    if (!e.target.value){setSf4Month(null);return;}
                    const [m,y,t]=e.target.value.split("-");
                    setSf4Month(TERM_MONTHS.find(x=>x.month===parseInt(m)&&x.year===parseInt(y)&&x.term===parseInt(t))||null);
                  }}>
                  <option value="">-- Select Month --</option>
                  {TERM_MONTHS.map((m,i)=><option key={i} value={`${m.month}-${m.year}-${m.term}`}>{m.label}</option>)}
                </select>
                {checkingSf4&&(
                  <div style={{fontSize:11,color:T.textMuted}}>Checking attendance encoding for this month…</div>
                )}
                {!checkingSf4&&sf4Incomplete&&sf4Incomplete.length>0&&(
                  <div style={{fontSize:11.5,color:"#8a5a00",background:"#fff6db",
                    border:"1px solid #f0d878",borderRadius:6,padding:"8px 10px",lineHeight:1.5}}>
                    ⚠️ {sf4Incomplete.length} section(s) haven't saved Daily Attendance for this month yet,
                    so their learners will be excluded from ADA / % Attendance in the report (marked *):<br/>
                    <strong>{sf4Incomplete.join(", ")}</strong>
                  </div>
                )}
                <Btn onClick={generateSF4} disabled={genBusy}>📄 Generate DepEd SF4 PDF ({sf4Level})</Btn>
              </div>
            </Card>
            <div style={{fontSize:11,color:T.textMuted,padding:"0 4px"}}>
              SF2 and SF4 use the same School Calendar and Daily Attendance dates. The monthly school-day count is the admin-configured value, and
              the generators will stop when the configured school-day count does not match the actual date grid, preventing inconsistent reports. SF2 will also refuse to generate if that section hasn't saved attendance for the selected
              month yet. SF4 follows the DepEd SF4 structure for registered learners, attendance, NLPA, transferred out/in, and mortality. Movement figures come from each
              learner's Enrollment Status — edit a learner in the Students tab to update it. The generated form uses the official-style landscape/legal table structure and M/F/T groupings.
              A section that hasn't saved Daily Attendance for the month is excluded from that
              row's ADA / % Attendance (marked *) rather than counted as 0% — generate its SF2
              first, or re-generate SF4 once it's encoded.
            </div>
          </div>
        )}

        {tab==="appointments"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📅 All Appointments</div>
            {appointments.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No appointments.</div></Card>
              :appointments.map(a=>(
                <Card key={a.id} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontWeight:700,fontSize:13,color:T.text}}>{studentNameText(a.student_name)}</div>
                    <Badge text={a.status}
                      color={a.status==="Pending"?T.yellow:a.status==="Approved"?T.green4:T.red}/>
                  </div>
                  <div style={{fontSize:12,color:T.textMuted}}>Teacher: {a.teacher_name}</div>
                  <div style={{fontSize:12,color:T.textMuted}}>📅 {a.date} at {a.time}</div>
                  <div style={{fontSize:12,marginTop:4,color:T.text}}>{a.reason}</div>
                  <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                    {a.status==="Pending"&&<>
                      <Btn color={T.green3} style={{padding:"5px 12px",fontSize:11}}
                        onClick={()=>updateApptStatus(a.id,"Approved")}>✅ Approve</Btn>
                      <Btn color={T.red} style={{padding:"5px 12px",fontSize:11}}
                        onClick={()=>updateApptStatus(a.id,"Declined")}>❌ Decline</Btn>
                    </>}
                    <Btn color="#795548" style={{padding:"5px 12px",fontSize:11}}
                      onClick={()=>delAppt(a.id)}>🗑️ Delete</Btn>
                  </div>
                </Card>
              ))
            }
          </div>
        )}
          </div>
        </div>
      </div>

      <BottomNav
        tabs={[
          ["📊","Overview","overview"],["📈","Statistics","statistics"],["⚙️","Settings","settings"],
          ["🎓","Students","students"],["👨‍🏫","Teachers","teachers"],
          ["🏫","Sections","sections"],["📚","Subjects","subjects"],
          ["📝","Grades","grades"],["📅","Calendar","calendar"],
          ["📄","Forms","forms"],["🗓️","Appts","appointments"],
        ]}
        active={tab} setActive={setTab}/>
    </div>
  );
};

// ─── MAIN APP ────────────────────────────────────────────
// v2.3 mobile-first experience: connection awareness, touch feedback,
// pull-to-refresh and an unobtrusive native-app status surface.
const MobileExperienceLayer = () => {
  const [online,setOnline]=useState(navigator.onLine);
  const [refreshing,setRefreshing]=useState(false);

  useEffect(()=>{
    const on=()=>setOnline(true), off=()=>setOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return ()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};
  },[]);

  useEffect(()=>{
    let touchStart=0;
    const down=e=>{
      if(window.scrollY<=2) touchStart=e.touches[0].clientY;
    };
    const up=async e=>{
      const end=e.changedTouches?.[0]?.clientY||0;
      if(window.scrollY<=2 && touchStart && end-touchStart>95 && !refreshing){
        setRefreshing(true);
        window.setTimeout(()=>window.location.reload(),350);
      }
      touchStart=0;
    };
    window.addEventListener("touchstart",down,{passive:true});
    window.addEventListener("touchend",up,{passive:true});
    return ()=>{window.removeEventListener("touchstart",down);window.removeEventListener("touchend",up);};
  },[refreshing]);

  return <>
    {!online && <div className="connection-banner" role="status">⚠️ You're offline. Saved information will remain available where supported.</div>}
    {refreshing && <div className="refresh-indicator" role="status"><span>↻</span> Refreshing AGRIANS…</div>}
    <div className={`mobile-status-pill ${online?'is-online':'is-offline'}`} aria-label={online?'Online':'Offline'}>
      <span className="status-pulse"/>{online?'Online':'Offline'}
    </div>
  </>;
};

const InstallAppPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsStandalone(Boolean(standalone));
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShow(true); };
    window.addEventListener('beforeinstallprompt', handler);
    const installed = () => setShow(false);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', handler); window.removeEventListener('appinstalled', installed); };
  }, []);

  if (isStandalone || !show) return null;
  return (
    <div className="install-app-prompt" role="dialog" aria-label="Install AGRIANS">
      <div className="install-app-icon">🌱</div>
      <div className="install-app-copy">
        <strong>Install AGRIANS</strong>
        <span>Use AGRIANS like an Android app — faster access from your home screen.</span>
      </div>
      <button className="install-app-btn" onClick={async()=>{
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null); setShow(false);
      }}>Install</button>
      <button className="install-app-close" aria-label="Dismiss" onClick={()=>setShow(false)}>×</button>
    </div>
  );
};

export default function App() {
  const [session,setSession]=useState(null);
  const [profile,setProfile]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>setSession(session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return ()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if (!session){setProfile(null);setLoading(false);return;}
    setLoading(true);
    supabase.from("profiles").select("*").eq("id",session.user.id).single()
      .then(({data})=>{setProfile(data);setLoading(false);});
  },[session]);

  const handleLogout=async()=>{
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <>
      <style>{css}</style>
      <MobileExperienceLayer />
      <InstallAppPrompt />
      {loading?<Spinner/>
        :!session||!profile?<Login/>
        :profile.role==="student"?<StudentDashboard profile={profile} onLogout={handleLogout}/>
        :profile.role==="teacher"?<TeacherDashboard profile={profile} onLogout={handleLogout}/>
        :<AdminDashboard profile={profile} onLogout={handleLogout}/>
      }
    </>
  );
}
