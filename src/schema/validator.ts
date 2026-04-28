import Ajv2020 from "ajv/dist/2020";
import schema from "./instructions.schema.json";

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });

/** Compiled ajv validator for the vendored Tomo instruction-set schema (ADR-1, ADR-2). */
export const validateInstructionSet = ajv.compile(schema);
