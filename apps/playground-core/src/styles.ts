/** Minimal styling for the playground. Imported for its side effect. */
const style = document.createElement("style");
style.textContent = `
  :root { font-family: system-ui, sans-serif; }
  body { margin: 0; }
  .app { min-height: 100vh; padding: 24px; transition: background .2s, color .2s; }
  .app.light { background: #f6f7f9; color: #16181d; }
  .app.dark  { background: #16181d; color: #f6f7f9; }
  h1 { margin: 0; font-size: 22px; }
  h2 { margin: 0; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  button { padding: 6px 12px; border-radius: 6px; border: 1px solid #8884; background: #ff0055; color: #fff; cursor: pointer; font-weight: 600; }
  button:hover { filter: brightness(1.1); }
  .nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 14px; padding: 10px; border-radius: 10px; background: #8881; }
  .navlink { padding: 6px 12px; border-radius: 6px; background: #ff0055; color: #fff; text-decoration: none; font-weight: 600; }
  .navlink:hover { filter: brightness(1.1); }
  .path { margin-left: auto; opacity: .7; }
  .page { margin-top: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
  .panel { padding: 16px; border-radius: 10px; background: #8881; border: 1px solid #8883; }
  .label { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #ff0055; letter-spacing: .3px; }
  .big { font-size: 26px; min-width: 40px; text-align: center; }
  .muted { opacity: .75; }
  .small { font-size: 12px; }
  .badge { padding: 4px 8px; border-radius: 6px; background: #8883; font-size: 13px; }
  .hovercard { transition: transform .15s, box-shadow .15s; }
  .hovercard.on { transform: translateY(-3px); box-shadow: 0 8px 24px #ff005544; }
  .toast { padding: 10px 14px; border-radius: 8px; background: #00b37e; color: #fff; font-weight: 600; }
  kbd, code { padding: 2px 6px; border-radius: 4px; background: #8883; font-family: monospace; }
  .grid-table { border-collapse: collapse; margin-top: 16px; }
  .grid-table th, .grid-table td { border: 1px solid #8884; padding: 8px 14px; text-align: left; }
  .grid-table th { background: #8882; font-size: 13px; }
  .grid-table .rowlabel { font-weight: 700; color: #ff0055; }
  .twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
  .col { padding: 12px; border-radius: 10px; background: #8881; border: 1px solid #8883; }
  .tasks { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .task { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 6px; background: #8882; }
  .task.done span { opacity: .6; text-decoration: line-through; }
  .task span { flex: 1; }
  .task button { padding: 3px 8px; font-size: 12px; }
  .matrix-wrap { margin-top: 24px; }
  .matrix { display: grid; gap: 6px; margin-top: 8px; }
  .mcell { padding: 10px; border-radius: 6px; background: #8882; text-align: center; }
  .mcell.head { font-weight: 700; color: #ff0055; background: #8883; }
  .slotcase { margin-top: 22px; padding: 14px; border-radius: 10px; background: #8881; border: 1px solid #8883; }
  .slotcase h3 { margin: 0; font-size: 15px; }
  .slotlist { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; margin: 10px 0 0; border-radius: 8px; background: #8882; }
  .slotlist > li { cursor: pointer; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: #8883; font-size: 13px; }
  .chip.chrome { background: #ff005522; border: 1px dashed #ff0055; }
  .chip .count { min-width: 16px; text-align: center; border-radius: 999px; background: #0003; padding: 0 5px; font-size: 11px; }
  .textrow { display: inline-flex; gap: 4px; align-items: center; padding: 10px; border-radius: 8px; background: #8882; }
  .textrow .mid { opacity: .7; }
  .heavy { padding: 14px; border-radius: 8px; background: #00b37e22; border: 1px solid #00b37e; margin-top: 10px; }
`;
document.head.appendChild(style);
