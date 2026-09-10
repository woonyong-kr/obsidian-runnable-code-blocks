import { createHash } from "node:crypto";
import ts from "typescript";

// ReactDOM's script resources are outside the self-contained preview contract.
// Remove the implementations, rather than relying only on the downstream CSP.
// Review the four paths again when updating ReactDOM; never silently skip a patch.
const upstreamSha256 = "6cf4932e0c20a4572ae395035ca2e512a42d7d49c1a659fa73d6197069c28df0";
const denied = 'throw Error("External script resources are not supported in run-react. Keep the example self-contained.");';

export function restrictReactDOM(source) {
  if (createHash("sha256").update(source).digest("hex") !== upstreamSha256) {
    throw new Error("ReactDOM source changed: review the preview script restrictions before building.");
  }
  const file = ts.createSourceFile("react-dom-client.production.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  const expected = new Set(["preinitScript", "preinitModuleScript", "completeWork", "acquireResource"]);
  for (const declaration of file.statements) {
    if (!ts.isFunctionDeclaration(declaration) || !declaration.body || !expected.has(declaration.name?.text)) continue;
    const name = declaration.name.text;
    if (name === "preinitScript" || name === "preinitModuleScript") {
      edits.push({ start: declaration.body.getStart(file), end: declaration.body.end, text: `{ ${denied} }` });
      expected.delete(name);
      continue;
    }
    function visit(node) {
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "script") {
        if (!expected.delete(name)) throw new Error(`Ambiguous ReactDOM script restriction: ${name}`);
        edits.push({ start: node.getStart(file), end: node.end, text: `case "script": ${denied}\n` });
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration.body);
  }
  if (expected.size || edits.length !== 4) throw new Error("Incomplete ReactDOM script restrictions.");
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}
