export type ErrorCode =
  | "CONFIG_INVALID"
  | "ALIAS_NOT_FOUND"
  | "NAME_INVALID"
  | "SAME_LOCATION"
  | "SOURCE_MISSING"
  | "DESTINATION_EXISTS"
  | "DESTINATION_LOCKED"
  | "SENSITIVE_UNAVAILABLE"
  | "VALUE_LOCKED"
  | "VALUES_DIFFER"
  | "CONFIRMATION_REQUIRED"
  | "UNVERIFIED_DELETE_REQUIRES_ACK"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ARGUMENTS"
  | "PROVIDER_AUTH"
  | "PROVIDER_INPUT"
  | "PROVIDER_PROMPT"
  | "PROVIDER_STDIN"
  | "PROVIDER_FAILED"
  | "LOCAL_FILE_UNSAFE"
  | "LOCAL_FILE_INVALID"
  | "RULES_INSTALL_FAILED";

const messages: Record<ErrorCode, string> = {
  CONFIG_INVALID: "Configuration is missing or invalid.",
  ALIAS_NOT_FOUND: "The requested alias is not configured.",
  NAME_INVALID: "The environment-variable name is invalid.",
  SAME_LOCATION: "Source and destination resolve to the same name and location.",
  SOURCE_MISSING: "The requested name is not present at the source.",
  DESTINATION_EXISTS: "The destination already contains that name; use --overwrite to replace it.",
  DESTINATION_LOCKED: "The existing destination is locked and cannot be replaced safely.",
  SENSITIVE_UNAVAILABLE: "Vercel Sensitive storage is unavailable for the selected account or target.",
  VALUE_LOCKED: "The requested value is non-readable and cannot be used as a source.",
  VALUES_DIFFER: "The destination value could not be verified as equal.",
  CONFIRMATION_REQUIRED: "The source-deletion confirmation is missing or does not match the source name.",
  UNVERIFIED_DELETE_REQUIRES_ACK: "Deleting after an unverifiable Vercel Sensitive write requires explicit acknowledgement.",
  PROVIDER_UNAVAILABLE: "A required provider command is unavailable.",
  PROVIDER_ARGUMENTS: "The installed provider CLI rejected the generated command arguments.",
  PROVIDER_AUTH: "The provider rejected authorization for the requested operation.",
  PROVIDER_INPUT: "The provider rejected the private stdin value or non-interactive input mode.",
  PROVIDER_PROMPT: "The provider attempted an interactive prompt that is unsafe for agent use.",
  PROVIDER_STDIN: "The provider rejected secret input over stdin.",
  PROVIDER_FAILED: "The provider operation failed. Provider output was suppressed.",
  LOCAL_FILE_UNSAFE: "The local dotenv target is unsafe to access.",
  LOCAL_FILE_INVALID: "The local dotenv file is malformed or contains duplicate names.",
  RULES_INSTALL_FAILED: "Agent guardrails could not be installed safely."
};

export class KeyperError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(messages[code]);
    this.name = "KeyperError";
    this.code = code;
  }
}

export function asSafeError(error: unknown): KeyperError {
  return error instanceof KeyperError
    ? error
    : new KeyperError("PROVIDER_FAILED");
}
