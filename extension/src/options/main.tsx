import React from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options.js";
import "../popup/styles.css";

createRoot(document.getElementById("root")!).render(<Options />);
