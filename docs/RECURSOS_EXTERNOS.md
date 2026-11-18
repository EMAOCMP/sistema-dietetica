# Recursos fuera del proyecto

Para que la carpeta del repo quede liviana, estos elementos **ya no viven acá**:

| Elemento | Qué era |
|---|---|
| `.opencode/` | skills locales del agente (7 paquetes: design, slides, ui-ux-pro-max…) |
| `.agents/` | skills locales del agente (frontend-design, webapp-testing) |
| `presentacion/` | deck de la presentación (HTML + PDF) y sus assets |
| `skills-lock.json` | lock de las skills |

Están en:

```
C:\Users\swami\Desktop\Dietetica\Dietetica-Extras\
```

Están en `.gitignore`, así que Git no las ve y no vuelven a aparecer como pendientes.

## Si hace falta alguno

- **Deck**: abrir `Dietetica-Extras\presentacion\index.html`, o el PDF
  `Vishal-Diet-pitch.pdf`.
- **Skills del agente**: mover la carpeta de vuelta al proyecto (o reinstalarla)
  y reiniciar la sesión. Mientras estén afuera, esas skills no se cargan.

## Restaurar todo

```powershell
$dst = "C:\Users\swami\Desktop\Dietetica\Dietetica-Extras"
foreach ($i in @('.opencode','.agents','presentacion','skills-lock.json')) {
  Move-Item -Path (Join-Path $dst $i) -Destination .
}
```

Después, quitar el bloque “Recursos fuera del proyecto” de `.gitignore`.
