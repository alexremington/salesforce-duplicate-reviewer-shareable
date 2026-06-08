function buildCodexTrainingCommand({
  codexBin = "codex",
  rootDir,
  prompt,
  model = "",
  reasoningEffort = ""
}) {
  const modelArg = model ? ` --model ${shellQuote(model)}` : "";
  const reasoningArg = reasoningEffort
    ? ` -c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
    : "";

  return `${shellQuote(codexBin)} --cd ${shellQuote(rootDir)}${modelArg}${reasoningArg} ${shellQuote(prompt)}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

module.exports = {
  buildCodexTrainingCommand
};
