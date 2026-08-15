import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/righteous/latin-400.css";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
