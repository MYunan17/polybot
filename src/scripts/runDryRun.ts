void (async () => {
  process.env.DRY_RUN = "true";
  const { runPhase2Seed } = await import("../index");
  await runPhase2Seed();
})();
