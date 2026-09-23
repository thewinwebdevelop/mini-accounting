function sanitizeWorkflowReturnTo(value) {
  if (typeof value !== "string" || value === "") return "";
  if (!value.startsWith("/")) return "";
  if (value.startsWith("//")) return "";
  if (value.includes("\\")) return "";
  return value;
}
