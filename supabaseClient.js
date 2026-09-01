// supabaseClient.js
// Include the Supabase CDN script BEFORE this file on every page that needs auth:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="supabaseClient.js"></script>

// From Supabase dashboard: Settings -> API
const SUPABASE_URL = "https://fftvdsagvbcmjsiizaan.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmdHZkc2FndmJjbWpzaWl6YWFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA4NDksImV4cCI6MjEwMzc3Njg0OX0.WGDphpgV7eR9eIR1n6SRMtidazoflU__jgnGWwJQD1M"; // safe to expose client-side, NOT the service_role key

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
