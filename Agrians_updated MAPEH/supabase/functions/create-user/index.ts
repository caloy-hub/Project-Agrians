import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json();
    let {
      role, email, password, name,
      lrn, grade_level, section_id, gender, birthday, address,
      tve_qualification, shs_track,
    } = body;

    // Curriculum heads may only ever create students, and only within their
    // own assigned grade level — the client-supplied role/grade_level are
    // ignored for them so this can't be spoofed from the browser.
    if (isCurriculumHead) {
      role = "student";
      grade_level = callerProfile.assigned_grade_level;
    }

    if (!role || !email || !password || !name) {
      return new Response(JSON.stringify({ error: "role, email, password, and name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!["student", "teacher"].includes(role)) {
      return new Response(JSON.stringify({ error: "role must be student or teacher" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isCurriculumHead && role !== "student") {
      return new Response(JSON.stringify({ error: "Curriculum Heads may only add students" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Students log in with their LRN (the frontend looks up profiles.lrn to
    // find the matching email, then signs in). student_no is no longer used.
    if (role === "student" && !lrn) {
      return new Response(JSON.stringify({ error: "lrn is required for students" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Guard against duplicate LRNs before creating the auth user, so we don't
    // end up with an orphaned auth user if the profile insert fails on a
    // unique-constraint violation.
    if (role === "student") {
      const { data: existing } = await adminClient
        .from("profiles")
        .select("id")
        .eq("lrn", lrn)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ error: `A student with LRN ${lrn} already exists.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const profileData: Record<string, unknown> = {
      id: newUser.user.id,
      role,
      name,
      email,
    };

    if (role === "student") {
      profileData.lrn         = lrn;
      profileData.grade_level = parseInt(grade_level);
      profileData.section_id  = section_id || null;
      profileData.gender      = gender   || null;
      profileData.birthday    = birthday || null;
      profileData.address     = address  || null;
      profileData.tve_qualification = tve_qualification || null;
      profileData.shs_track         = shs_track || null;
    }

    const { error: insertError } = await adminClient
      .from("profiles")
      .insert(profileData);

    if (insertError) {
      // Roll back the auth user so we don't leave an orphaned login with no profile.
      await adminClient.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: insertError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ success: true, userId: newUser.user.id, name, role }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});