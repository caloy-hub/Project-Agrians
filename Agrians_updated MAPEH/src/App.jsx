// ============================================================
//  App.jsx — FINAL COMPLETE VERSION v5
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

const GRADE_LEVELS = [7, 8, 9, 10, 11, 12];

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

const T = {
  bg:"#f0f7ee", bgCard:"#ffffff", bgPanel:"#e8f5e2",
  green1:"#1b4d1f", green2:"#2d6a30", green3:"#3a8c3f",
  green4:"#4caf50", greenLight:"#81c784",
  yellow:"#f5c800", yellowDark:"#e6a800",
  blue:"#003082", red:"#c62828",
  white:"#ffffff", gray:"#6a7c6a",
  border:"#b8dab840", text:"#1b3a1e", textMuted:"#4a7a4e",
};

const css = `
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',sans-serif;}
  body{background:#f0f7ee;color:#1b3a1e;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-thumb{background:#3a8c3f;border-radius:4px;}
  input,select,textarea{
    background:#e8f5e2;color:#1b3a1e;border:1px solid #b8dab8;
    border-radius:8px;padding:10px 14px;width:100%;outline:none;font-size:14px;
  }
  input:focus,select:focus,textarea:focus{border-color:#4caf50;box-shadow:0 0 0 2px #4caf5020;}
  button{cursor:pointer;border:none;border-radius:8px;font-weight:600;transition:all .2s;}
  @keyframes spin{to{transform:rotate(360deg)}}
`;

const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;

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
    return vals.length ? Math.round((vals.reduce((a,b)=>a+b,0) / vals.length) * 100) / 100 : null;
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
      <div style={{height:8,borderRadius:6,background:"#e0f0e0",overflow:"hidden",marginBottom:8}}>
        <div style={{height:"100%",width:`${percent||0}%`,background:encodingColor(percent),transition:"width .3s"}}/>
      </div>
      {doneSubjects.length===0&&pendingSubjects.length===0
        ?<div style={{fontSize:11,color:T.gray}}>No subjects apply to this section yet.</div>
        :(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {doneSubjects.map(s=>(
              <span key={s.subject.id} style={{fontSize:10,fontWeight:700,color:"#2e7d32",
                background:"#e8f5e9",border:"1px solid #c8e6c9",borderRadius:10,padding:"2px 8px"}}>
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
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`},
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

const Card = ({ children, style={} }) => (
  <div style={{background:T.bgCard,borderRadius:12,padding:16,
    border:"1px solid #c8e6c9",boxShadow:"0 2px 8px #00000010",...style}}>
    {children}
  </div>
);
const Btn = ({ children, onClick, color=T.green3, style={}, disabled=false }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background:disabled?"#ccc":color,color:color===T.yellow?"#1b3a1e":T.white,
    padding:"10px 16px",fontSize:13,boxShadow:disabled?"none":"0 2px 6px #00000020",
    ...style,opacity:disabled?.6:1}}>{children}</button>
);
const Badge = ({ text, color }) => (
  <span style={{background:color+"22",color,border:`1px solid ${color}55`,
    borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{text}</span>
);
const Toast = ({ msg }) => msg?(
  <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",
    background:msg.startsWith("✅")?T.green2:msg.startsWith("🗑️")?"#5d4037":
    msg.startsWith("⏳")?T.blue:"#b71c1c",
    color:"#fff",padding:"10px 20px",borderRadius:20,fontSize:13,fontWeight:700,
    zIndex:999,boxShadow:"0 4px 20px #0008",whiteSpace:"nowrap"}}>{msg}</div>
):null;
const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
    height:"100vh",background:T.bg,flexDirection:"column",gap:16}}>
    <div style={{width:48,height:48,border:"4px solid #c8e6c9",
      borderTop:`4px solid ${T.green3}`,borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    <div style={{color:T.textMuted,fontSize:14,fontWeight:600}}>Loading...</div>
  </div>
);

const SchoolHeader = ({ small=false }) => (
  <div style={{padding:small?"10px 12px":"20px 16px",
    background:"linear-gradient(160deg,#0d2e10 0%,#1b4d1f 30%,#2d6a30 65%,#3a6b20 100%)",
    borderBottom:`4px solid ${T.yellow}`,boxShadow:"0 4px 12px #0005",
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
        overflow:"hidden",background:"linear-gradient(160deg,#1b4d1f,#2d6a30)",
        display:"flex",alignItems:"center",justifyContent:"center"}}>
        <img src={mcpbahsLogo} alt="MCPBAHS Logo"
          style={{width:"100%",height:"100%",objectFit:"cover"}}/>
      </div>
      <div style={{textAlign:"left"}}>
        <div style={{fontSize:small?9:11,color:"#a5d6a7",fontWeight:600,letterSpacing:.5,lineHeight:1.5}}>
          Department of Education · Region XI · Division of Davao City
        </div>
        <div style={{fontSize:small?13:17,fontWeight:900,color:"#ffffff",lineHeight:1.2,textShadow:"0 1px 4px #0006"}}>
          Maria Cristina P. Belcar
        </div>
        <div style={{fontSize:small?13:17,fontWeight:900,color:T.yellow,lineHeight:1.2,textShadow:"0 1px 4px #0006"}}>
          Agricultural High School
        </div>
        <div style={{fontSize:small?9:11,color:"#a5d6a7",marginTop:3,display:"flex",gap:8,alignItems:"center"}}>
          <span>School ID: 304342</span>
          <span style={{color:T.yellow}}>·</span>
          <span>S.Y. 2026–2027</span>
        </div>
      </div>
    </div>
    <div style={{position:"absolute",bottom:0,left:0,right:0,height:small?3:5,
      background:"linear-gradient(90deg,#2d6a30,#4caf50,#f5c800,#4caf50,#2d6a30)",opacity:0.7}}/>
  </div>
);

const AgriansBranding = () => (
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",
    justifyContent:"center",textAlign:"center",padding:"20px 20px 0px 20px",
    width:"100%",maxWidth:400}}>
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
    borderBottom:"2px solid #c8e6c9",boxShadow:"0 2px 6px #00000010"}}>
    <div>
      <div style={{fontWeight:700,fontSize:14,color:T.green1}}>{name}</div>
      <div style={{fontSize:11,color:T.textMuted}}>{sub}</div>
    </div>
    <Btn onClick={onLogout} color={T.red} style={{padding:"6px 12px",fontSize:12}}>Logout</Btn>
  </div>
);

const BottomNav = ({ tabs, active, setActive }) => (
  <div style={{position:"fixed",bottom:0,left:0,right:0,background:T.bgCard,
    borderTop:"2px solid #c8e6c9",display:"flex",zIndex:100,boxShadow:"0 -2px 8px #00000015"}}>
    {tabs.map(([ic,lb,tb])=>(
      <button key={tb} onClick={()=>setActive(tb)} style={{
        flex:1,padding:"10px 2px",background:"transparent",border:"none",cursor:"pointer",
        color:active===tb?T.green2:T.gray,display:"flex",flexDirection:"column",
        alignItems:"center",fontSize:9,fontWeight:active===tb?700:400,gap:2,
        borderTop:active===tb?`2px solid ${T.green3}`:"2px solid transparent"}}>
        <span style={{fontSize:18}}>{ic}</span>{lb}
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
      <Card style={{width:"100%",maxWidth:360}}>
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
    tve_qualification:"",grade11_track:"",grade11_techpro_choice:"",grade12_track:""
  });
  const effectiveGrade=parseInt(gradeFilter||form.grade_level);
  const needsTve=effectiveGrade>=8&&effectiveGrade<=10; // TVE qualification applies to Grades 8-10 only
  const isGrade11=effectiveGrade===11;
  const isGrade12=effectiveGrade===12;
  const needsTechProChoice=isGrade11&&form.grade11_track==="TechPro";
  const availSections=gradeFilter
    ?sections.filter(s=>s.grade_level===parseInt(gradeFilter))
    :sections.filter(s=>s.grade_level===parseInt(form.grade_level));
  const resetForm=()=>setForm({name:"",lrn:"",grade_level:gradeFilter||7,section_id:"",
    gender:"Male",birthday:"",address:"",email:"",password:"",
    tve_qualification:"",grade11_track:"",grade11_techpro_choice:"",grade12_track:""});
  const submit=()=>{
    if (needsTve&&!form.tve_qualification){
      alert("Please select the student's TVE Qualification."); return;
    }
    if (isGrade11&&!form.grade11_track){
      alert("Please select the student's Grade 11 Track (Academic or TechPro)."); return;
    }
    if (needsTechProChoice&&!form.grade11_techpro_choice){
      alert("Please select the TechPro specialization (Bakery Operations or Organic Agriculture Production)."); return;
    }
    if (isGrade12&&!form.grade12_track){
      alert("Please select the student's Grade 12 Track (TVL-AFA or TVL-HE)."); return;
    }
    // Build a single shs_track label for storage, e.g.
    // "TechPro - Organic Agriculture Production" or "Academic" or "TVL-AFA"
    let shsTrack=null;
    if (isGrade11) {
      shsTrack=form.grade11_track==="TechPro"
        ?`TechPro - ${form.grade11_techpro_choice}`
        :"Academic";
    } else if (isGrade12) {
      shsTrack=form.grade12_track;
    }
    onAdd({
      ...form,
      tve_qualification:needsTve?form.tve_qualification:null,
      shs_track:shsTrack,
    });
    resetForm();
  };
  return (
    <Card style={{marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Student</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <input placeholder="Full Name *" value={form.name}
          onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
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
        {isGrade11&&(
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
        {isGrade12&&(
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
      grade_level:canChangeGrade?gradeLevel:undefined,
      enrollment_status:form.enrollment_status,
      status_date:form.enrollment_status==="Active"?null:form.status_date,
    });
    setSaving(false);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:250,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Card style={{width:"100%",maxWidth:400,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontSize:15,fontWeight:800,color:T.green1,marginBottom:4}}>✏️ Edit Learner</div>
        <div style={{fontSize:11,color:T.textMuted,marginBottom:12}}>
          Correct any encoding errors below, then save.
        </div>
        <div style={{display:"grid",gap:8,marginBottom:8}}>
          <input placeholder="Full Name *" value={form.name}
            onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
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
            <input placeholder="SHS Track" value={form.shs_track}
              onChange={e=>setForm(p=>({...p,shs_track:e.target.value}))}/>
          )}
          <input placeholder="Address" value={form.address}
            onChange={e=>setForm(p=>({...p,address:e.target.value}))}/>

          <div style={{borderTop:"1px solid #e0f0e0",paddingTop:8,marginTop:2}}>
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

const SectionGroup = ({ sectionName, adviserName, total, males, females, qualStats, children }) => {
  const [open,setOpen]=useState(true);
  return (
    <div style={{marginBottom:12}}>
      <div onClick={()=>setOpen(p=>!p)} style={{cursor:"pointer",fontSize:12,fontWeight:700,
        color:T.green2,background:"#e8f5e9",padding:"6px 10px",borderRadius:6,
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
          border:"1px solid #c8e6c9",borderRadius:10,padding:"2px 8px"}}>
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
                      borderLeft:"2px solid #d4e8d4"}}>
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
          <div style={{fontWeight:700,fontSize:13,color:T.text}}>{s.name}</div>
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
        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #e0f0e0"}}>
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
        Encode the number of school days per month. Adviser attendance is based on these values.
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
      // Check if student access is locked
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

  return (
    <div style={{minHeight:"100vh",
      background:"linear-gradient(160deg,#e8f5e2 0%,#f0f7ee 50%,#e1f0e1 100%)",
      display:"flex",flexDirection:"column"}}>
      <SchoolHeader/>
      <div style={{flex:1,display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",padding:"20px 20px 40px 20px"}}>
        <AgriansBranding/>
        <Card style={{width:"100%",maxWidth:400,boxShadow:"0 8px 32px #00000015",marginTop:16}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:22,fontWeight:800,color:T.green1}}>Welcome</div>
            <div style={{fontSize:12,color:T.textMuted}}>School Year 2026–2027</div>
          </div>
          <div style={{display:"flex",gap:4,marginBottom:18,background:T.bgPanel,borderRadius:8,padding:4}}>
            {["student","teacher","admin"].map(r=>(
              <button key={r} onClick={()=>setRole(r)} style={{
                flex:1,padding:"8px 4px",borderRadius:6,fontSize:12,fontWeight:700,
                background:role===r?T.green3:"transparent",color:role===r?T.white:T.textMuted,
                border:"none",cursor:"pointer",textTransform:"capitalize"}}>{r}</button>
            ))}
          </div>
          <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>
            {role==="student"?"LRN (Learner Reference Number)":"Email Address"}
          </label>
          <input value={id} onChange={e=>setId(e.target.value)}
            placeholder={role==="student"?"Enter your 12-digit LRN":"e.g. user@mcpbahs.edu.ph"}
            onKeyDown={e=>e.key==="Enter"&&doLogin()} style={{marginBottom:12}}/>
          <label style={{fontSize:12,color:T.textMuted,display:"block",marginBottom:4}}>Password</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
            placeholder="Enter password" onKeyDown={e=>e.key==="Enter"&&doLogin()}
            style={{marginBottom:16}}/>
          {err&&<div style={{color:T.red,fontSize:12,marginBottom:10,
            background:T.red+"15",padding:"8px 12px",borderRadius:6}}>{err}</div>}
          <Btn onClick={doLogin} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>
            {loading?"Logging in...":"🔐 Login"}
          </Btn>
          <div style={{display:"flex",height:4,borderRadius:4,overflow:"hidden",marginTop:16}}>
            <div style={{flex:1,background:T.blue}}/><div style={{flex:1,background:T.red}}/>
            <div style={{flex:1,background:T.yellow}}/>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── STUDENT DASHBOARD ───────────────────────────────────
const StudentDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("grades");
  const [subjects,setSubjects]=useState([]);
  const [grades,setGrades]=useState([]);
  const [teachers,setTeachers]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [attendance,setAttendance]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [section,setSection]=useState(null);
  const [apptForm,setApptForm]=useState({teacherId:"",date:"",time:"",reason:""});
  const [apptMsg,setApptMsg]=useState("");
  const [loading,setLoading]=useState(true);
  const [toast,setToast]=useState("");
  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),2500);};

  const fetchData=useCallback(async()=>{
    setLoading(true);
    const [sR,gR,tR,aR,attR,calR,secR]=await Promise.all([
      supabase.from("subjects").select("*").eq("grade_level",profile.grade_level),
      supabase.from("grades").select("*").eq("student_id",profile.id),
      supabase.from("profiles").select("id,name").eq("role","teacher"),
      supabase.from("appointments").select("*").eq("student_id",profile.id),
      supabase.from("attendance").select("*").eq("student_id",profile.id),
      supabase.from("school_calendar").select("*").order("year").order("month"),
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
    if (attR.data) setAttendance(attR.data);
    if (calR.data) setCalendar(calR.data);
    if (secR.data) setSection(secR.data);
    setLoading(false);
  },[profile.id,profile.grade_level,profile.section_id,profile.tve_qualification]);

  useEffect(()=>{
    fetchData();
    const ch=supabase.channel("student-realtime")
      .on("postgres_changes",{event:"*",schema:"public",table:"grades",
        filter:`student_id=eq.${profile.id}`},()=>fetchData())
      .on("postgres_changes",{event:"*",schema:"public",table:"attendance",
        filter:`student_id=eq.${profile.id}`},()=>fetchData())
      .subscribe();
    return ()=>supabase.removeChannel(ch);
  },[fetchData,profile.id]);

  const getG=(subId,term)=>gradeForTerm(subjects.find(s=>s.id===subId),term,subjects,grades);
  const getFinal=subId=>avg([1,2,3].map(t=>getG(subId,t)).filter(Boolean));
  // MAPEH's two components feed into the MAPEH row itself — don't also
  // count them separately or they'd be averaged into the general average twice.
  const overallAvg=avg(subjects.filter(s=>!s.parent_subject_id).map(s=>getFinal(s.id)).filter(Boolean));

  const getTermAttendance=term=>{
    const termMonths=TERM_MONTHS.filter(m=>m.term===term);
    let totalDays=0,totalPresent=0;
    termMonths.forEach(m=>{
      const cal=calendar.find(c=>c.month===m.month&&c.year===m.year&&c.term===term);
      const att=attendance.find(a=>a.month===m.month&&a.year===m.year&&a.term===term);
      totalDays+=(cal?.school_days||0); totalPresent+=(att?.days_present||0);
    });
    const absent=totalDays-totalPresent;
    const pct=totalDays>0?Math.round((totalPresent/totalDays)*100):0;
    return {totalDays,totalPresent,absent,pct};
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
      <TopBar name={profile.name}
        sub={`Grade ${profile.grade_level}${section?" – "+section.name:""} · LRN: ${profile.lrn}`}
        onLogout={onLogout}/>
      <div style={{flex:1,overflowY:"auto",padding:14,paddingBottom:72}}>

        {tab==="profile"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>👤 Student Profile</div>
            <Card style={{marginBottom:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[["Full Name",profile.name],["LRN",profile.lrn],
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
            <Card style={{textAlign:"center",marginBottom:10}}>
              <div style={{fontSize:11,color:T.textMuted}}>General Average</div>
              <div style={{fontSize:38,fontWeight:900,color:T.green2}}>{overallAvg||"—"}</div>
              {overallAvg&&<Badge text={remark(overallAvg).r} color={remark(overallAvg).c}/>}
            </Card>
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
                      <tr key={s.id} style={{background:i%2===0?T.bgCard:"#f1f8f1",
                        borderBottom:comps.length?"none":"1px solid #e0f0e0"}}>
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
                        <tr key={c.id} style={{background:i%2===0?T.bgCard:"#f1f8f1",
                          borderBottom:"1px solid #e0f0e0"}}>
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
                    const cal=calendar.find(c=>c.month===m.month&&c.year===m.year&&c.term===m.term);
                    const att=attendance.find(a=>a.month===m.month&&a.year===m.year&&a.term===m.term);
                    const sd=cal?.school_days||0,dp=att?.days_present||0,ab=sd-dp;
                    const pct=sd>0?Math.round((dp/sd)*100):0;
                    return (
                      <tr key={i} style={{background:i%2===0?T.bgCard:"#f1f8f1",
                        borderBottom:"1px solid #e0f0e0"}}>
                        <td style={{padding:"6px 8px"}}>
                          <div style={{fontWeight:600,color:T.text}}>{m.label}</div>
                          <div style={{fontSize:9,color:T.textMuted}}>Term {m.term}</div>
                        </td>
                        <td style={{textAlign:"center",color:T.text}}>{sd||"—"}</td>
                        <td style={{textAlign:"center",color:T.green2,fontWeight:700}}>{sd?dp:"—"}</td>
                        <td style={{textAlign:"center",color:ab>0?T.red:T.gray}}>{sd?ab:"—"}</td>
                        <td style={{textAlign:"center",fontWeight:700,
                          color:sd?attendColor(pct):T.gray}}>{sd?pct+"%":"—"}</td>
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
                background:apptMsg.startsWith("✅")?"#e8f5e9":"#ffebee",
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
      <BottomNav
        tabs={[["👤","Profile","profile"],["📊","Grades","grades"],["📅","Appt","appointment"]]}
        active={tab} setActive={setTab}/>
      <Toast msg={toast}/>
    </div>
  );
};

// ─── TEACHER DASHBOARD ───────────────────────────────────
const TeacherDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("encode");
  const [subjects,setSubjects]=useState([]);
  const [students,setStudents]=useState([]);
  const [mySection,setMySection]=useState(null);
  const [classStudents,setClassStudents]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [selSubject,setSelSubject]=useState("");
  const [selTerm,setSelTerm]=useState(1);
  const [selSection,setSelSection]=useState("");
  const [localGrades,setLocalGrades]=useState({});
  const [dbGrades,setDbGrades]=useState([]);
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

  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),2500);};

  const fetchData=useCallback(async()=>{
    setLoading(true);
    const [sR,aR,secR,qR,holR]=await Promise.all([
      supabase.from("subjects").select("*").eq("teacher_id",profile.id),
      supabase.from("appointments").select("*").eq("teacher_id",profile.id),
      supabase.from("sections").select("*").eq("adviser_id",profile.id).single(),
      supabase.from("tve_qualifications").select("*").order("name"),
      supabase.from("school_holidays").select("*").order("date"),
    ]);
    if (sR.data) setSubjects(sR.data);
    if (aR.data) setAppointments(aR.data);
    if (qR.data) setQualifications(qR.data.map(q=>q.name));
    if (holR.data) setHolidays(holR.data);
    if (secR.data) {
      setMySection(secR.data);
      const {data:stuData}=await supabase.from("profiles").select("*")
        .eq("role","student").eq("section_id",secR.data.id).order("gender").order("name");
      if (stuData) setClassStudents(stuData);
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
    if (data) setChStudents(data);
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

  // Compute each student's per-term and final general average from classGrades
  const computeHonorsRoll=()=>{
    const studentsInScope=honorsScope==="grade"?gradeLevelStudents:classStudents;
    const subjectIds=allGradeSubjects.map(s=>s.id);
    return studentsInScope.map(stu=>{
      const myGrades=classGrades.filter(g=>g.student_id===stu.id&&subjectIds.includes(g.subject_id));
      const termAvgs=[1,2,3].map(term=>{
        const termGrades=myGrades.filter(g=>g.term===term).map(g=>g.grade);
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
    if (!selSubject||!selSection) { setStudents([]); return; }
    const sub=subjects.find(s=>s.id===selSubject);
    if (!sub) return;
    (async()=>{
      // Scope the roster to one section at a time (per-section encoding), and
      // if this subject is tagged with a TVE qualification, only show students
      // who are assigned that exact qualification within that section.
      let stuQuery=supabase.from("profiles").select("*")
        .eq("role","student").eq("grade_level",sub.grade_level).eq("section_id",selSection);
      if (sub.tve_qualification) stuQuery=stuQuery.eq("tve_qualification",sub.tve_qualification);
      const [stuR,gR]=await Promise.all([
        stuQuery.order("name"),
        supabase.from("grades").select("*").eq("subject_id",selSubject).eq("term",selTerm),
      ]);
      if (stuR.data) setStudents(stuR.data);
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
    const days=schoolDaysInMonth(selAttMonth,holidays);
    if (!days.length){notify("⚠️ No school days in this range (check holidays).");return;}
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

    // Keep the legacy monthly summary (used elsewhere in the app) and the
    // school_calendar day count in sync with the real daily grid.
    const {month,year,term}=selAttMonth;
    const monthlyRows=classStudents.map(s=>{
      const presentCount=days.filter(d=>getDailyStatus(s.id,d.date)==="present").length;
      return {student_id:s.id,month,year,term,days_present:presentCount,encoded_by:profile.id};
    });
    await supabase.from("attendance").upsert(monthlyRows,{onConflict:"student_id,month,year,term"});
    await supabase.from("school_calendar")
      .upsert({month,year,term,school_days:days.length},{onConflict:"month,year,term"});

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
    if ((gradeLevel===11||gradeLevel===12)&&!form.shs_track){
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

    notify("⏳ Generating certificate...");
    // Certificate's TERM line: "Term 1" -> "TERM 1", "Final / Year-End" -> "FINAL AVERAGE"
    const termText=periodLabel.startsWith("Term")
      ?periodLabel.toUpperCase()
      :"FINAL AVERAGE";
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData?.session?.access_token;
    try {
      const res=await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-certificate`,
        {method:"POST",
         headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
         body:JSON.stringify({
           student_id:student.id,period_label:termText,
           average,honor_title:"ACADEMIC EXCELLENCE AWARD",
           school_year:"2026-2027",day,month,
         })}
      );
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate certificate"}));
        notify("❌ "+(err.error||"Failed to generate certificate"));
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
         headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
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
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`SF9_${student.name.replace(/\s+/g,"_")}_${periodLabel.replace(/\s+/g,"_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify("✅ SF9 downloaded!");
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
         headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
         body:JSON.stringify({
           section_id:mySection.id, month:sf2Month.month, year:sf2Month.year, term:sf2Month.term,
         })}
      );
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate SF2"}));
        notify("❌ "+(err.error||"Failed to generate SF2"));
        return;
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`SF2_${mySection.name.replace(/\s+/g,"_")}_${sf2Month.label.replace(/\s+/g,"_")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify("✅ SF2 downloaded!");
    } catch (e) {
      notify("❌ "+String(e.message||e));
    }
  };

  const tabs=[["✏️","Encode","encode"],["📅","Appts","appointments"]];
  if (mySection) tabs.splice(1,0,["🏫","My Class","myclass"],["📆","Attendance","attendance"],
    ["🏆","Honors","honors"],["📄","Forms","reports"]);
  if (profile.is_curriculum_head) tabs.push(["🎓","Students","chstudents"]);

  if (loading) return <Spinner/>;

  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <SchoolHeader small/>
      <TopBar name={profile.name}
        sub={`Teacher${mySection?" · Adviser: "+mySection.name:""}${profile.is_curriculum_head?" · Curriculum Head Gr."+profile.assigned_grade_level:""}`}
        onLogout={onLogout}/>
      <Toast msg={toast}/>
      {editStudent&&(
        <EditStudentModal student={editStudent}
          sections={sections.filter(s=>s.grade_level===profile.assigned_grade_level)}
          qualifications={qualifications} canChangeGrade={false}
          onSave={handleUpdateStudent} onClose={()=>setEditStudent(null)}/>
      )}
      <div style={{flex:1,overflowY:"auto",padding:14,paddingBottom:72}}>

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
                      setSelSection(sub?.section_id||"");
                    }}>
                    <option value="">-- Select --</option>
                    {subjects.filter(s=>!isMapehParent(s,subjects)).map(s=><option key={s.id} value={s.id}>
                      {s.name} (Gr.{s.grade_level}{s.tve_qualification?` · ${s.tve_qualification}`:""}
                      {s.section_id?` · Sec. ${sections.find(sc=>sc.id===s.section_id)?.name||"?"}`:""})
                    </option>)}
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
                if (sub?.section_id) {
                  // This subject belongs to one specific section only — nothing to pick.
                  const secName=sections.find(sc=>sc.id===sub.section_id)?.name||"?";
                  return (
                    <div style={{fontSize:12,color:T.green2,fontWeight:600,
                      background:"#e8f5e9",borderRadius:6,padding:"6px 10px"}}>
                      📍 Section: {secName} (this subject is assigned to this section only)
                    </div>
                  );
                }
                const secOptions=sections.filter(s=>s.grade_level===sub?.grade_level);
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
                  :students.map(s=>(
                    <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,
                      padding:"8px 0",borderBottom:"1px solid #e0f0e0"}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{s.name}</div>
                        <div style={{fontSize:11,color:T.textMuted}}>LRN: {s.lrn}</div>
                      </div>
                      <input type="number" min="0" max="100" style={{width:72,textAlign:"center"}}
                        value={getGradeVal(s.id)}
                        onChange={e=>setLocalGrades(p=>({...p,[`${s.id}-${selSubject}-${selTerm}`]:e.target.value}))}
                        placeholder="0–100"/>
                    </div>
                  ))
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
                            background:"#fff",whiteSpace:"nowrap"}}>{student.name}</td>
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
                        <div style={{fontWeight:700,fontSize:13,color:T.text}}>{s.name}</div>
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
                        <div style={{fontWeight:700,fontSize:13,color:T.text}}>{s.name}</div>
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
                                  padding:"4px 8px",borderBottom:"1px solid #e0f0e0",fontWeight:600,color:T.text}}>
                                  {s.name}
                                </td>
                                {days.map(d=>{
                                  const status=getDailyStatus(s.id,d.date);
                                  const present=status==="present";
                                  return (
                                    <td key={d.date} style={{padding:2,textAlign:"center",
                                      borderBottom:"1px solid #e0f0e0"}}>
                                      <div onClick={()=>toggleDaily(s.id,d.date)}
                                        style={{width:20,height:20,borderRadius:4,margin:"0 auto",
                                          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                                          fontWeight:800,fontSize:11,
                                          background:present?"#e8f5e9":"#ffebee",
                                          color:present?T.green3:T.red,
                                          border:`1px solid ${present?"#c8e6c9":"#f0c0c0"}`}}>
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
                    {classStudents.map(s=><option key={s.id} value={s.id}>{s.name} (LRN: {s.lrn})</option>)}
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
                  background:advApptMsg.startsWith("✅")?"#e8f5e9":"#ffebee",
                  color:advApptMsg.startsWith("✅")?T.green2:T.red}}>{advApptMsg}</div>}
                <Btn onClick={submitAdvAppt} style={{width:"100%"}}>📩 Schedule Conference</Btn>
              </Card>
            )}
            {appointments.length===0
              ?<Card><div style={{textAlign:"center",color:T.gray,padding:20}}>No appointments.</div></Card>
              :appointments.map(a=>(
                <Card key={a.id} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontWeight:700,color:T.text}}>{a.student_name}</div>
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
                          <div style={{fontSize:12,fontWeight:600,color:T.text}}>{student.name}</div>
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
                      <div style={{fontWeight:700,fontSize:13,color:T.text}}>{s.name}</div>
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
      <BottomNav tabs={tabs} active={tab} setActive={setTab}/>
    </div>
  );
};

// ─── ADMIN DASHBOARD ─────────────────────────────────────
const AdminDashboard = ({ profile, onLogout }) => {
  const [tab,setTab]=useState("overview");
  const [students,setStudents]=useState([]);
  const [teachers,setTeachers]=useState([]);
  const [subjects,setSubjects]=useState([]);
  const [grades,setGrades]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [sections,setSections]=useState([]);
  const [calendar,setCalendar]=useState([]);
  const [holidays,setHolidays]=useState([]);
  const [toast,setToast]=useState("");
  const [loading,setLoading]=useState(true);
  const [editGrade,setEditGrade]=useState(null);
  const [editStudent,setEditStudent]=useState(null);
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
  const [nSubject,setNSubject]=useState({name:"",grade_level:7,teacher_id:"",tve_qualification:"",section_id:""});
  const [nGrade,setNGrade]=useState({student_id:"",subject_id:"",term:1,grade:""});
  const [nSection,setNSection]=useState({name:"",grade_level:7,adviser_id:""});

  const notify=m=>{setToast(m);setTimeout(()=>setToast(""),3000);};

  const fetchAll=useCallback(async()=>{
    setLoading(true);
    const [sR,tR,subR,gR,aR,secR,calR,settR,qR,holR]=await Promise.all([
      supabase.from("profiles").select("*").eq("role","student").order("grade_level").order("name"),
      supabase.from("profiles").select("*").eq("role","teacher").order("name"),
      supabase.from("subjects").select("*").order("grade_level"),
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
    if ((gradeLevel===11||gradeLevel===12)&&!form.shs_track){
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
    }).select().single();
    if (error){notify("❌ "+error.message);return;}
    setNSubject({name:"",grade_level:7,teacher_id:"",tve_qualification:"",section_id:""});
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

  const reassignTeacher=async(subId,teacherId)=>{
    await supabase.from("subjects").update({teacher_id:teacherId||null}).eq("id",subId);
    notify("✅ Teacher reassigned!"); fetchAll();
  };

  const reassignQualification=async(subId,qualName)=>{
    await supabase.from("subjects").update({tve_qualification:qualName||null}).eq("id",subId);
    notify("✅ TVE Qualification updated!"); fetchAll();
  };

  const reassignSubjectSection=async(subId,sectionId)=>{
    await supabase.from("subjects").update({section_id:sectionId||null}).eq("id",subId);
    notify("✅ Section scope updated!"); fetchAll();
  };

  // ── DepEd FORMS (SF2 / SF4) ──
  const [sf2Section,setSf2Section]=useState("");
  const [sf2Month,setSf2Month]=useState(null);
  const [sf4Level,setSf4Level]=useState("JHS");
  const [sf4Month,setSf4Month]=useState(null);
  const [genBusy,setGenBusy]=useState(false);

  const downloadPdf=async(fnName,body,filename)=>{
    setGenBusy(true);
    notify("⏳ Generating "+filename+"...");
    const {data:sessionData}=await supabase.auth.getSession();
    const token=sessionData?.session?.access_token;
    try {
      const res=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
        {method:"POST",
         headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
         body:JSON.stringify(body)});
      if (!res.ok) {
        const err=await res.json().catch(()=>({error:"Failed to generate "+filename}));
        notify("❌ "+(err.error||"Failed to generate "+filename));
        return;
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify("✅ Downloaded!");
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

      {resetModal&&(
        <ResetPasswordModal user={resetModal}
          onConfirm={handleResetPassword} onClose={()=>setResetModal(null)}/>
      )}
      {editStudent&&(
        <EditStudentModal student={editStudent} sections={sections}
          qualifications={qualifications.map(q=>q.name)} canChangeGrade={true}
          onSave={handleUpdateStudent} onClose={()=>setEditStudent(null)}/>
      )}
      {editGrade&&(
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <Card style={{width:"100%",maxWidth:360}}>
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

      <div style={{flex:1,overflowY:"auto",padding:14,paddingBottom:72}}>

        {tab==="overview"&&(
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:12}}>
              🏫 Overview — S.Y. 2026–2027
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {stats.map(s=>(
                <Card key={s.label} style={{textAlign:"center",padding:14}}>
                  <div style={{fontSize:26}}>{s.icon}</div>
                  <div style={{fontSize:32,fontWeight:900,color:s.color}}>{s.value}</div>
                  <div style={{fontSize:11,color:T.textMuted}}>{s.label}</div>
                </Card>
              ))}
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
                      {subjects.filter(s=>s.teacher_id===t.id).map(s=>s.name).join(", ")||"No subjects"}
                    </div>
                    {t.is_curriculum_head&&(
                      <Badge text={`Curriculum Head Gr.${t.assigned_grade_level}`} color={T.green2}/>
                    )}
                    {sections.find(s=>s.adviser_id===t.id)&&(
                      <Badge text={`Adviser: ${sections.find(s=>s.adviser_id===t.id)?.name}`} color="#7b1fa2"/>
                    )}
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <Btn color={T.blue} style={{padding:"5px 8px",fontSize:11}}
                      onClick={()=>setResetModal({userId:t.id,name:t.name,role:"teacher"})}>🔑</Btn>
                    <Btn color={T.red} style={{padding:"5px 8px",fontSize:11}}
                      onClick={()=>delTeacher(t.id)}>🗑️</Btn>
                  </div>
                </div>
                <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #e0f0e0"}}>
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
                          <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                            onClick={()=>delSection(sec.id)}>🗑️</Btn>
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
            <div style={{fontSize:15,fontWeight:700,color:T.green1,marginBottom:10}}>📚 Manage Subjects</div>
            <Card style={{marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:10}}>➕ Add Subject</div>
              <div style={{display:"grid",gap:8,marginBottom:8}}>
                <input placeholder="Subject Name *" value={nSubject.name}
                  onChange={e=>setNSubject(p=>({...p,name:e.target.value}))}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <select value={nSubject.grade_level}
                    onChange={e=>setNSubject(p=>({...p,grade_level:e.target.value,section_id:"",
                      tve_qualification:(parseInt(e.target.value)>=8&&parseInt(e.target.value)<=10)
                        ?p.tve_qualification:""}))}>
                    {GRADE_LEVELS.map(g=><option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select value={nSubject.teacher_id}
                    onChange={e=>setNSubject(p=>({...p,teacher_id:e.target.value}))}>
                    <option value="">-- Teacher (opt) --</option>
                    {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <select value={nSubject.section_id}
                  onChange={e=>setNSubject(p=>({...p,section_id:e.target.value}))}>
                  <option value="">-- All sections in this grade (default) --</option>
                  {sections.filter(s=>s.grade_level===parseInt(nSubject.grade_level)).map(s=>
                    <option key={s.id} value={s.id}>Only Section: {s.name}</option>)}
                </select>
                {parseInt(nSubject.grade_level)>=8&&parseInt(nSubject.grade_level)<=10&&(
                  <select value={nSubject.tve_qualification}
                    onChange={e=>setNSubject(p=>({...p,tve_qualification:e.target.value}))}>
                    <option value="">-- TVE Qualification (none / general subject) --</option>
                    {qualifications.map(q=><option key={q.id} value={q.name}>{q.name}</option>)}
                  </select>
                )}
              </div>
              <Btn onClick={addSubject} style={{width:"100%"}}>➕ Add Subject</Btn>
            </Card>
            {GRADE_LEVELS.map(gl=>{
              // MAPEH's components render nested under their parent, not as
              // separate top-level cards.
              const subs=subjects.filter(s=>s.grade_level===gl&&!s.parent_subject_id);
              if (!subs.length) return null;
              const isTveGrade=gl>=8&&gl<=10;
              return (
                <div key={gl} style={{marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.white,background:T.green1,
                    padding:"4px 10px",borderRadius:6,marginBottom:6}}>Grade {gl}</div>
                  {subs.map(s=>{
                    const comps=mapehComponentsOf(s,subjects);
                    const isMapeh=s.name.trim().toUpperCase()==="MAPEH";
                    return (
                      <div key={s.id}>
                        <Card style={{marginBottom:comps.length||isMapeh?4:6,padding:"10px 12px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",
                            alignItems:"center",marginBottom:6}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:13,color:T.text}}>{s.name}</div>
                              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:2}}>
                                {isMapeh&&<Badge text="🧩 Averaged from components" color={T.green3}/>}
                                {s.tve_qualification&&<Badge text={s.tve_qualification} color="#7b1fa2"/>}
                                {s.section_id&&<Badge
                                  text={`📍 ${sections.find(sc=>sc.id===s.section_id)?.name||"?"} only`}
                                  color={T.blue}/>}
                              </div>
                            </div>
                            <Btn color={T.red} style={{padding:"5px 10px",fontSize:11}}
                              onClick={()=>delSubject(s.id)}>🗑️</Btn>
                          </div>
                          {!isMapeh&&(
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                              <div style={{fontSize:11,color:T.textMuted,flexShrink:0}}>Teacher:</div>
                              <select value={s.teacher_id||""}
                                onChange={e=>reassignTeacher(s.id,e.target.value)}
                                style={{fontSize:12,padding:"5px 8px"}}>
                                <option value="">-- Unassigned --</option>
                                {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                          )}
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isTveGrade?8:0}}>
                            <div style={{fontSize:11,color:T.textMuted,flexShrink:0}}>Section:</div>
                            <select value={s.section_id||""}
                              onChange={e=>reassignSubjectSection(s.id,e.target.value)}
                              style={{fontSize:12,padding:"5px 8px"}}>
                              <option value="">-- All sections in Gr.{gl} --</option>
                              {sections.filter(sec=>sec.grade_level===gl).map(sec=>
                                <option key={sec.id} value={sec.id}>Only: {sec.name}</option>)}
                            </select>
                          </div>
                          {isTveGrade&&!isMapeh&&(
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{fontSize:11,color:T.textMuted,flexShrink:0}}>TVE Qual.:</div>
                              <select value={s.tve_qualification||""}
                                onChange={e=>reassignQualification(s.id,e.target.value)}
                                style={{fontSize:12,padding:"5px 8px"}}>
                                <option value="">-- None / General --</option>
                                {qualifications.map(q=><option key={q.id} value={q.name}>{q.name}</option>)}
                              </select>
                            </div>
                          )}
                        </Card>
                        {comps.length>0&&(
                          <div style={{marginLeft:16,marginBottom:8,paddingLeft:10,
                            borderLeft:"2px solid #c8e6c9"}}>
                            {comps.map(c=>(
                              <Card key={c.id} style={{marginBottom:6,padding:"8px 10px"}}>
                                <div style={{display:"flex",justifyContent:"space-between",
                                  alignItems:"center",marginBottom:6}}>
                                  <div style={{fontWeight:600,fontSize:12,color:T.text}}>🧩 {c.name}</div>
                                  <Btn color={T.red} style={{padding:"4px 8px",fontSize:10}}
                                    onClick={()=>delSubject(c.id)}>🗑️</Btn>
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <div style={{fontSize:11,color:T.textMuted,flexShrink:0}}>Teacher:</div>
                                  <select value={c.teacher_id||""}
                                    onChange={e=>reassignTeacher(c.id,e.target.value)}
                                    style={{fontSize:12,padding:"5px 8px"}}>
                                    <option value="">-- Unassigned --</option>
                                    {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                                  </select>
                                </div>
                              </Card>
                            ))}
                          </div>
                        )}
                        {isMapeh&&comps.length===0&&(
                          <div style={{marginBottom:10}}>
                            <Btn color={T.yellowDark} style={{fontSize:11,padding:"6px 10px"}}
                              onClick={()=>addMapehComponents(s)}>
                              ➕ Add PE and Health / Music and Arts components
                            </Btn>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
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
                  {students.map(s=><option key={s.id} value={s.id}>{s.name} (LRN: {s.lrn})</option>)}
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

            <div style={{fontSize:13,fontWeight:700,color:T.green2,marginBottom:6}}>
              School Form 4 — Movement & Attendance Report
            </div>
            <Card style={{marginBottom:12}}>
              <div style={{display:"grid",gap:8}}>
                <div style={{display:"flex",gap:8}}>
                  {["JHS","SHS"].map(lv=>(
                    <button key={lv} onClick={()=>setSf4Level(lv)}
                      style={{flex:1,padding:"10px 0",borderRadius:8,fontSize:13,fontWeight:700,
                        background:sf4Level===lv?T.green3:"#e8f5e2",color:sf4Level===lv?T.white:T.textMuted}}>
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
                <Btn onClick={generateSF4} disabled={genBusy}>📄 Generate SF4 PDF ({sf4Level})</Btn>
              </div>
            </Card>
            <div style={{fontSize:11,color:T.textMuted,padding:"0 4px"}}>
              SF2 uses the Daily Attendance grid each adviser encodes for their section.
              SF4 movement figures (transferred in/out, dropped out) come from each learner's
              Enrollment Status — edit a learner in the Students tab to update it.
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
                    <div style={{fontWeight:700,fontSize:13,color:T.text}}>{a.student_name}</div>
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

      <BottomNav
        tabs={[
          ["📊","Overview","overview"],["⚙️","Settings","settings"],
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
      {loading?<Spinner/>
        :!session||!profile?<Login/>
        :profile.role==="student"?<StudentDashboard profile={profile} onLogout={handleLogout}/>
        :profile.role==="teacher"?<TeacherDashboard profile={profile} onLogout={handleLogout}/>
        :<AdminDashboard profile={profile} onLogout={handleLogout}/>
      }
    </>
  );
}
