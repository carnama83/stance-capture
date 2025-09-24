import "./lib/supabaseClient";           // ← side-effect import so [ENV CHECK] always logs
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
