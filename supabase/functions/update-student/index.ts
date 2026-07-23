import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fields a caller is allowed to correct on an already-encoded learner.
// (Email/password changes stay in create-user / reset-password — this is
// specifically the "fix a typo / wrong section / wrong LRN" edit flow.)
const EDITABLE_FIELDS = [
  "name", "lrn", "gender", "birthday", "address",
  "section_id", "tve_qualification", "shs_track",
  "enrollment_status", "status_date",
];

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
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role, is_curriculum_head, assigned_grade_level")
      .eq("id", caller.id)
      .single();

    const isAdmin = callerProfile?.role === "admin";
    const isCurriculumHead = callerProfile?.role === "teacher" && callerProfile?.is_curriculum_head === true;

    if (!isAdmin && !isCurriculumHead) {
      return new Response(JSON.stringify({ error: "Forbidden: Admin or Curriculum Head access only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { studentId, updates, grade_level: newGradeLevel } = await req.json();

    if (!studentId || !updates || typeof updates !== "object") {
      return new Response(JSON.stringify({ error: "studentId and updates are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, role, grade_level, lrn")
      .eq("id", studentId)
      .single();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ error: "Student not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (targetProfile.role !== "student") {
      return new Response(JSON.stringify({ error: "This endpoint can only edit student records" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // A Curriculum Head may only correct learners within their own assigned
    // grade level, and may never move a student out of that grade level.
    if (isCurriculumHead) {
      if (targetProfile.grade_level !== callerProfile.assigned_grade_level) {
        return new Response(JSON.stringify({ error: "Forbidden: this student is outside your assigned grade level" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (newGradeLevel !== undefined && parseInt(newGradeLevel) !== callerProfile.assigned_grade_level) {
        return new Response(JSON.stringify({ error: "Curriculum Heads cannot change a student's grade level" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Build a sanitized patch, only touching allowed fields that were actually sent.
    const patch: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        patch[field] = updates[field];
      }
    }
    // Grade level (and thus section) may only be changed by an admin.
    if (isAdmin && newGradeLevel !== undefined) {
      patch.grade_level = parseInt(newGradeLevel);
    }

    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ error: "No editable fields were provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Guard against duplicate LRNs if the LRN is being changed.
    if (patch.lrn && patch.lrn !== targetProfile.lrn) {
      const { data: existing } = await adminClient
        .from("profiles")
        .select("id")
        .eq("lrn", patch.lrn)
        .neq("id", studentId)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ error: `Another student already has LRN ${patch.lrn}.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { error: updateErr } = await adminClient
      .from("profiles")
      .update(patch)
      .eq("id", studentId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ success: true, studentId, updated: Object.keys(patch) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
