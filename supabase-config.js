// Supabase Configuration File
// Replace values with your own from Supabase dashboard

const SUPABASE_URL = "https://fqthxzaorgroaobvarov.supabase.co";
const SUPABASE_KEY = "sb_publishable_eGRAc88JCypa0-jYFhL8BA_AwCs6gg0";

// Create Supabase client
const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// You can test connection (optional)
console.log("Supabase connected:", SUPABASE_URL);
