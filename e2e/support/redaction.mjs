const SECRET_PATTERNS = [
  /(cookie\s*[:=]\s*[^;\s]+|sweet_house_session=[^;\s]+)/gi,
  /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
  /((?:oauth[_ -]?code|code|file[_ -]?token|service[_ -]?(?:key|role[_ -]?key))\s*[:=]\s*)[^\s,;&]+/gi,
  /(?:PDF-CONTENTS|business-file-bytes|document-bytes|file-bytes)/gi,
];

const SENSITIVE_FIELD = /^(?:authorization|body|bytes|content|cookie|document|documentText|file|fileBytes|fileToken|oauthCode|raw|serviceKey|storageState|trace)$/i;

function redactStructured(value) {
  if (Array.isArray(value)) return value.map(redactStructured);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactStructured(child)]));
}

export function redactE2ELog(value) {
  let output = typeof value === "string" ? value : JSON.stringify(redactStructured(value));
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, (match, prefix = "") => {
    if (/^authorization\s*[:=]/i.test(match)) return `${prefix}[REDACTED]`;
    return "[REDACTED]";
  });
  return output.replace(/\b(?:sk|key|token|secret)[-_A-Za-z0-9]{12,}\b/gi, "[REDACTED]");
}
