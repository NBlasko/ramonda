import { bootstrap } from "@ramonda/core";
import { App } from "./App";
import "./style.css";

const root = document.getElementById("app");
if (root) bootstrap(<App />, root);
