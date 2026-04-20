/**
 * Offline tests for ProLine API response parsing (no network).
 * Run: npm run proline:selftest
 */
import { runProlineApiParseSelfTest } from "../src/lib/proline-api-client";

runProlineApiParseSelfTest();
console.log("proline API parse selftest: ok");
