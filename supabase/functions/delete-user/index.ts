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
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { userId, role } = await req.json();

    if (!userId || !role) {
      return new Response(JSON.stringify({ error: "userId and role are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!["student", "teacher"].includes(role)) {
      return new Response(JSON.stringify({ error: "role must be student or teacher" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (userId === caller.id) {
      return new Response(JSON.stringify({ error: "You cannot delete your own account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (role === "student") {
      await adminClient.from("grades").delete().eq("student_id", userId);
      await adminClient.from("appointments").delete().eq("student_id", userId);
    }

    if (role === "teacher") {
      await adminClient.from("subjects").update({ teacher_id: null }).eq("teacher_id", userId);
      await adminClient.from("appointments").delete().eq("teacher_id", userId);
      await adminClient.from("grades").update({ encoded_by: null }).eq("encoded_by", userId);
    }

    const { error: profileErr } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileErr) {
      return new Response(JSON.stringify({ error: "Profile delete failed: " + profileErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (authDeleteErr) {
      return new Response(JSON.stringify({ error: "Auth delete failed: " + authDeleteErr.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ success: true, deletedUserId: userId, role }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});