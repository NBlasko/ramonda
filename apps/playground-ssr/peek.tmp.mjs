try {
  await import("./dist/server/diagnostics-fixture.js");
  console.log("imported WITHOUT a DOM shim");
} catch (e) {
  console.log("import threw:", String(e).split("\n")[0].slice(0, 100));
}
