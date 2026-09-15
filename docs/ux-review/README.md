# Bolsillo · Estudio de flujos

Abrí [index.html](index.html) directamente en el navegador. Es un archivo independiente: funciona sin instalar dependencias ni iniciar la aplicación.

## Propuestas

| Propuesta | Experiencia |
| --- | --- |
| A · Registro ágil | Completar y registrar en un editor compacto. |
| B · Paso a paso | Capturar, revisar los datos y confirmar el movimiento. |
| C · Capturar y resolver | Capturar algo incompleto ahora y terminarlo desde pendientes después. |

Las tres priorizan móvil y permiten agregar, consultar, editar y continuar un borrador. C también ofrece lista e inspector juntos en escritorio. **Flujo elegido: B · Paso a paso.** La entrada destaca **Completar manualmente** antes de la opción de comprobante.

## Cómo probar

1. Leé los hallazgos en **Revisión** y abrí A, B o C.
2. Elegí **Ampliar prototipo** para usar la experiencia sin las notas del estudio.
3. Agregá un movimiento, consultá su detalle, editá el monto y elegí **Continuar después**.
4. Abrí **Pendientes**, retomá la edición y registrá los cambios. El borrador no modifica el saldo.
5. En B, elegí **Completar manualmente** o probá el comprobante de ejemplo. En **Completar**, usá **Adjuntos → Agregar archivos**: podés ver y quitar archivos sin analizar su contenido. El comprobante usado al empezar ya aparece en la lista. Los adjuntos se conservan en el borrador y se muestran al confirmar y consultar el movimiento.
6. En C, guardá una descripción en pendientes y completala después.
7. Volvé al estudio para comparar las ventajas y costos de cada alternativa.

**Simular** permite probar falla al guardar, solo consulta, borrador vencido, lista vacía, comprobante ilegible, moneda distinta y un bolsillo en USD. Algunos escenarios reemplazan los datos ficticios de la propuesta. **Reiniciar** restaura su ejemplo inicial.

Los datos se guardan en `localStorage`, separados por propuesta, bajo `bolsillo-ux-proposals-v1`. Si el navegador bloquea el almacenamiento, la interfaz lo informa. La lectura de comprobantes está simulada y su documento de ejemplo es independiente de los campos editables. En B podés adjuntar archivos locales: su contenido se guarda solo en este navegador y se conserva al recargar. Se admiten hasta 5 archivos de 2 MB (JPG, PNG, WebP, PDF o TXT), contando el comprobante de ejemplo. Si no hay espacio disponible en el navegador, la demo informa el problema y no agrega los archivos que no pudo guardar. No se envían archivos a un servidor ni se ejecuta extracción real. No hay llamadas a la aplicación ni modificaciones de datos reales.

## Revisión y evidencia

- [Informe de revisión](REVIEW.md): hallazgos, alcance y límites.
- [Contrato de las propuestas](DIRECTION.md): intención y diferencias entre experiencias.
- [24 comprobaciones iniciales](../../.impeccable/review/ux-proposals/browser-checks.json).
- [12 comprobaciones posteriores a la revisión final](../../.impeccable/review/ux-proposals/finish-checks.json).
- [Verificación de adjuntos en Paso a paso](../../.impeccable/review/ux-proposals/b-attachments-checks.json).
- [Capturas de móvil y escritorio](../../.impeccable/review/ux-proposals/).

La revisión final dio por resueltos los cuatro ajustes solicitados. Esa conclusión cubre el prototipo aislado; no constituye una validación de producción.
