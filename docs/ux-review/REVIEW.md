# Revisión UX/UI de Bolsillo

El mayor cambio propuesto es separar consulta, edición, borrador y registro. Hoy varias de esas intenciones comparten una pantalla y presentan promesas de guardado diferentes según las funciones habilitadas.

El usuario confirmó que el uso habitual es móvil y quiere elegir la experiencia después de probar alternativas. Las tres propuestas conservan el producto, su voz en español y su identidad; el usuario eligió B · Paso a paso, con la entrada manual más visible. Las alternativas permanecen como referencia del estudio.

## Método y límites

Dos evaluaciones independientes: A revisó diseño y flujos sin ver los resultados del detector; B revisó evidencia técnica y ejecutó el detector. La síntesis se realizó después de ambas evaluaciones. Base de código: `fae7d97941cb31099d2b67ca4b4c47bb1e7cad53`.

La aplicación autenticada no se ejecutó en este checkout: no había configuración local ni dependencias instaladas. El servidor encontrado en otro worktree correspondía a otra revisión y no se usó como evidencia. Los hallazgos de comportamiento se basan en código; su impacto de uso es una evaluación, no un resultado de investigación con usuarios.

Los prototipos sí se probaron en navegador, en escritorio y móvil, incluyendo 320 px, apertura directa del HTML y recuperación de borradores tras recargar. Pasaron 24 comprobaciones iniciales y 12 comprobaciones dirigidas después de la revisión final. No se ejecutaron pruebas de producción, autenticación, concurrencia real, permisos remotos ni carga o extracción real de archivos.

## Hallazgos prioritarios

| Prioridad | Evidencia actual | Cambio propuesto |
| --- | --- | --- |
| Alta · Consulta | Cada fila abre `/edit`; la ruta bloquea el contenido si no se permite administrar movimientos. | Crear detalle de lectura, disponible también en consulta o archivo, con una acción explícita para editar. |
| Alta · Continuidad | El formulario manual no guarda borradores. El asistido espera 650 ms y sus enlaces externos al formulario no pasan por `leave()`. | Una política común de borradores y salida; mostrar cambios pendientes inmediatamente y confirmar persistencia antes de salir. |
| Alta · Integridad del dinero | El selector de moneda sigue editable y la mutación reemplaza la moneda sin convertir importes. CRC y USD usan distintas unidades menores. | Bloquear moneda cuando existen movimientos o definir una migración explícita. Cambiar CRC a USD puede reinterpretar 10.000 unidades como $100,00. |
| Alta · Archivo y permisos | El bolsillo archivado aún enlaza a edición; actualizar comprueba el archivo, pero eliminar un movimiento no lo comprueba. | Alinear reglas de lectura y modificación entre interfaz y servidor. |
| Alta · Edición simultánea | El guardado manual no exige revisión del movimiento; el asistido sí comprueba una revisión base. | Aplicar control de revisiones a todos los caminos y conservar la edición cuando hay conflicto. |
| Media · Revisión de comprobantes | Las sugerencias aparecen separadas del campo. Fecha y tipo tienen valores iniciales y la aplicación automática solo completa valores vacíos. | Distinguir valores por defecto de decisiones del usuario; resolver discrepancias junto al dato y conservar el comprobante como evidencia independiente. |
| Media · Orientación | Los filtros sustituyen el saldo principal por el neto de los movimientos filtrados. | Mantener el saldo real y mostrar cantidad y neto del resultado junto a la búsqueda. |

Fuentes: [lista de movimientos](../../components/transaction-list.tsx), [formulario manual](../../components/transaction-form.tsx), [formulario asistido](../../components/assisted-transaction-form.tsx), [borradores](../../components/transaction-drafts-list.tsx), [detalle del bolsillo](../../app/wallets/[walletId]/page.tsx), [moneda](../../lib/money.ts), [mutaciones de bolsillos](../../convex/wallets.ts), [mutaciones de movimientos](../../convex/transactions.ts) y [mutaciones de borradores](../../convex/transactionDrafts.ts).

## Cobertura de la aplicación

| Flujo | Propuesta de mejora |
| --- | --- |
| Inicio y nuevo bolsillo | Mostrar pendientes por bolsillo y ofrecer el primer movimiento después de crear. Explicar restricciones de moneda y límites cuando sean pertinentes. |
| Agregar movimiento | Dar prioridad a monto y descripción, hacer opcionales los detalles adicionales y separar carga, extracción y registro. |
| Consultar movimiento | Mostrar datos completos, notas y comprobantes sin entrar a editar. |
| Editar movimiento | Explicitar que el original sigue vigente hasta guardar; mostrar el efecto en saldo y volver al detalle. |
| Continuar borrador | Distinguir nuevo movimiento de edición pendiente; mostrar monto, tarea pendiente y vencimiento. La política actual vence a las 24 horas desde la creación, sin extenderse al actualizar. |
| Buscar y filtrar | Añadir búsqueda, conservar filtros y posición al volver y separar resultados del saldo real. Evaluar paginación con volúmenes representativos. |
| Etiquetas | Unificar «Tags», «Label» y «Etiquetas» en el lenguaje visible. Conservar creación en contexto y el aviso de movimientos afectados al eliminar. |
| Archivar/restaurar/eliminar | Mantener consulta en archivo; distinguir archivo reversible de borrado permanente y explicar su efecto sobre movimientos, archivos y saldo. |
| Archivos y asistencia | Separar permisos de archivos y de IA. Definir recuperación cuando un borrador existente pierde acceso a funciones. Llevar la vista previa al detalle consultable. |
| Compartir | Mostrar qué información y filtros incluye la imagen antes de compartir. La función actual comparte un resumen, no acceso al bolsillo. |
| Ingreso y cuenta | Validar regreso al destino original, sesión expirada y estados de permisos con una cuenta de prueba. Ofrecer recuperación explícita en errores esperados. |
| Superadmin y auditoría | Unificar cuándo se guardan cambios, reforzar estados de operaciones y confirmaciones contextuales. Evaluar filtros y navegación de la auditoría por separado. |

## Accesibilidad y estados

Asociar errores a todos los campos, anunciar la corrección requerida y enfocar el primer error de validación de la aplicación. Dar nombre accesible al visor de archivos. Usar el primer plano coral oscuro para texto y fortalecer contraste de etiquetas seleccionadas y foco. Algunas interacciones actuales tienen objetivos de 36–42 px: aumentarlos hacia 44 px y comprobar textos largos. Desactivar giros con movimiento reducido en lugar de acelerar animaciones infinitas.

Durante un guardado lento, bloquear los campos enviados o conservar claramente los cambios posteriores. Añadir recuperación para enlaces a movimientos eliminados; una consulta que arroja un error no debe quedar confundida con carga indefinida.

Fuentes: [estilos actuales](../../app/globals.css), [visor de archivos](../../components/file-viewer-dialog.tsx), [estados de interfaz](../../components/ui-states.tsx) y los formularios citados arriba. Esto no es una certificación de accesibilidad ni una medición de rendimiento real.

## Tres experiencias para elegir

| Alternativa | Trabajo que favorece | Costo principal |
| --- | --- | --- |
| A · Registro ágil | Registrar un movimiento cotidiano en un editor compacto. | Menos guía para comprobantes complejos. |
| B · Paso a paso | Capturar, revisar y confirmar con un momento explícito para decidir. | Una confirmación adicional para gastos simples. |
| C · Capturar y resolver | Recopilar gastos incompletos desde el teléfono y terminarlos después. | Requiere una bandeja clara y más estados de navegación; en escritorio añade inspector. |

Las tres usan el mismo modelo: **borrador nuevo → registro**; **registro → edición pendiente → actualización del registro**. Descartar una edición pendiente conserva el original. Guardar un borrador nunca suma ni resta saldo. La propuesta elegida debe preservar esta distinción en todos sus puntos de entrada.

## Sistema conservado y decisiones acotadas

La autoridad visual sigue siendo [app/globals.css](../../app/globals.css): crema `#f8f5ed`, teal `#176b5b`, superficie `#fffdfa`, primer plano `#202522` y colores semánticos para ingresos y gastos. El HTML utiliza variantes oscuras existentes para legibilidad y una familia de sistema para funcionar sin conexiones externas. La densidad, jerarquía y distribución cambian dentro de las propuestas.

No se modificaron componentes, rutas ni reglas de la aplicación. Tampoco se creó un nuevo `DESIGN.md` ni se adoptaron tokens de propuesta como sistema aprobado. [PRODUCT.md](../../PRODUCT.md) registra contexto y decisiones pendientes; [DIRECTION.md](DIRECTION.md) limita las decisiones de este estudio.

El detector del código actual produjo una advertencia de estilo sobre la franja del encabezado, considerada un falso positivo como defecto UX. El detector del HTML produjo cero hallazgos. La revisión final pidió cuatro ajustes —evidencia de comprobante independiente, bloqueo de edición pendiente en consulta, comparación neutral y limpieza del modo ampliado de C— y luego confirmó los cuatro como resueltos.

## Próxima validación

Probar las tres experiencias con las mismas tareas: gasto manual, consulta de comprobante, cambio de monto, salida y reanudación de edición, y dato dudoso de un comprobante. Comparar finalización, errores, tiempo para retomar y comprensión de cuándo cambió el saldo. Esos resultados deben informar la elección del usuario; todavía no se han medido.
