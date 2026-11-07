// Copia los íconos SVG junto a los .js compilados: n8n los busca por la ruta
// relativa que declara cada nodo (`file:tellwing.svg`). Sin gulp, a propósito:
// una dependencia menos que revisar en la verificación de n8n.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
for (const dir of ["nodes/Tellwing", "nodes/TellwingTrigger", "credentials"]) {
  const from = path.join(root, dir)
  const to = path.join(root, "dist", dir)
  mkdirSync(to, { recursive: true })
  for (const file of readdirSync(from)) {
    if (file.endsWith(".svg")) copyFileSync(path.join(from, file), path.join(to, file))
  }
}
