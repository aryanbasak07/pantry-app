// Supabase connection for the shared (cloud) mode.
// The anon key is PUBLIC by design — Row Level Security protects the data.
// If this file is missing or the backend is unreachable, the app falls back
// to local-only mode automatically.
window.PANTRY_CONFIG = {
  url: "https://bitdzdfpzvvilhymvsio.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpdGR6ZGZwenZ2aWxoeW12c2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0Njk4MTksImV4cCI6MjA5NjA0NTgxOX0.yM2v5AecWCJfYA-F1mGuRQqO7BAeZ2pF6y1SqCKahiA",
  // Public VAPID key for Web Push (public by design). Private half lives only in
  // the Vercel env var VAPID_PRIVATE_KEY.
  vapidPublic:
    "BF4q-q4-4p5hTFMq3fCsvp-C3_F6bTKcRXC2LtRBhyJs18QuOXaPzSTP1fIg3eJi-N93RX4JPZdpETcK2f20o0A",
};
