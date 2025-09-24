import "./lib/supabaseClient"; // forces module to load, prints [ENV CHECK]
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";


import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/supabaseClient";
createRoot(document.getElementById("root")!).render(<App />);
