import { createRoot } from "react-dom/client";
import { LocalEditor } from "./components/LocalEditor";
import "./local.css";

createRoot(document.getElementById("root")!).render(<LocalEditor />);
