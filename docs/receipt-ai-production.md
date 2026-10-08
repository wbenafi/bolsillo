# Lectura de comprobantes: producción

La función permite extraer un movimiento desde imágenes, PDF o TXT mediante
`claude-haiku-5-5` y el SDK oficial `@anthropic-ai/sdk`, con esfuerzo de razonamiento `low`.
La persona revisa y guarda siempre. El proveedor
recibe bloques de imagen base64 y texto mediante Messages API; los PDF siguen
renderizándose en el servidor. La respuesta usa JSON Schema derivado de Zod y
se valida por campo antes de aplicarse.

## Variables del backend

Configurar estas variables en el deployment **Production de Convex**:

| Variable | Propósito |
| --- | --- |
| `ANTHROPIC_API_KEY` | Clave del proveedor usada por las acciones del backend |
| `ANTHROPIC_INPUT_USD_PER_MILLION` | Tarifa de entrada para estimar costos |
| `ANTHROPIC_OUTPUT_USD_PER_MILLION` | Tarifa de salida para estimar costos |

No requieren variables nuevas en Vercel ni prefijos `NEXT_PUBLIC_`. Las tarifas
son opcionales; sin ellas se registran análisis y tokens, pero no una estimación
de costo. No se necesita `QWEN_BASE_URL`: el SDK utiliza el endpoint oficial
de Anthropic. Las variables `QWEN_*` anteriores ya no se usan. Agregá la clave
de Anthropic en cada deployment de Convex donde se habilite la función, antes
de desplegar este cambio. No guardes la clave en el repositorio.

El registro suma los tokens de entrada, incluidos los de creación y lectura
de caché cuando existan, y usa el total de salida, que incluye el razonamiento.
La estimación usa las tarifas configuradas, sin ajustes de caché, y no
sustituye la factura del proveedor.
Se conserva el timeout de 30 segundos y no hay reintentos automáticos. El
límite de salida es de 8192 tokens para dejar espacio al razonamiento. Una
respuesta truncada o rechazada se registra como `invalid_response` y conserva
sus tokens; no se aplica al borrador.

El entorno de producción usa las credenciales R2 ya configuradas. No copiar
`R2_LOCAL_ENDPOINT`, `R2_LOCAL_PUBLIC_ENDPOINT`, `R2_LOCAL_PROXY_URL`,
`LOCAL_STORAGE_PROXY_TARGET` ni los overrides de Convex self-hosted. Los proxies
para probar en la red local solo se habilitan en desarrollo.

## Despliegue y activación

El flujo de Vercel Production existente ejecuta `convex deploy` antes del build
de Next.js. La configuración de Convex incluye Node 22 y las dependencias
externas para imágenes y PDF. El esquema agrega tablas de borradores,
extracciones y consumo, más campos opcionales en los registros existentes.

Después del deploy, un Superadmin debe habilitar **Archivos en movimientos** y
**Lectura de comprobantes con IA** para la cuenta piloto. La IA está apagada por
defecto. Su límite inicial es de 30 análisis enviados por cuenta y mes UTC,
configurable desde Superadmin; los envíos fallidos también consumen cupo.

Verificar una imagen y un PDF desde la aplicación: carga privada, extracción,
revisión manual, guardado y reapertura del adjunto. Probar también una moneda
distinta, un resultado parcial y retomar un borrador. Los borradores vencen a
las 24 horas y sus objetos pendientes se eliminan mediante la cola de limpieza.

Para detener nuevas lecturas, apagar el flag de IA de la cuenta. Se puede
guardar manualmente un resultado ya obtenido. No quitar credenciales R2 mientras
haya archivos o tareas de limpieza pendientes.

## Validación real de Claude Haiku 5.5: 7 de octubre de 2026

Se ejecutaron tres solicitudes secuenciales con comprobantes ficticios, usando
el cliente del proyecto, el prompt y esquema de producción, la preparación real
de imágenes/PDF y la validación/normalización de resultados. Todas devolvieron
`end_turn`, JSON válido, monto, moneda y fecha correctos.

| Muestra | Monto detectado | Duración de la solicitud |
| --- | --- | --- |
| TXT, bolsillo USD | USD 4.95 | 7.38 s |
| PNG, bolsillo CRC | CRC 18500.50 | 3.09 s |
| PDF de una página, bolsillo CRC | USD 27.40 | 3.18 s |

El PDF activó correctamente la advertencia de moneda diferente, sin conversión
a CRC. Los tokens de entrada/salida fueron 3295/424, 4360/410 y 4314/485.
Pasaron además 193 tests en 22 archivos, lint, TypeScript y build.

Los tiempos cubren solamente la petición al proveedor; no incluyen carga de
archivos, renderizado PDF ni espera de la aplicación. Estas pruebas no recorren
el navegador, las acciones de Convex ni el almacenamiento. Tres documentos
sintéticos no constituyen una evaluación general de precisión o latencia.

## Evidencia histórica de Qwen (antes de migrar a Anthropic)

Las pruebas reales y los tiempos de esta sección corresponden a Qwen. No
validan la precisión ni la latencia de Claude Haiku 5.5; se requiere una prueba con
comprobantes representativos y la nueva clave antes de habilitarlo en producción.

### Evidencia de validación previa al PR

Pasaron lint, TypeScript, build y 89 tests. La verificación local con MinIO
incluyó cargas/descargas firmadas, rechazo de firmas modificadas y el flujo de
revisión. Dos llamadas reales al modelo, con las muestras proporcionadas por el
usuario, extrajeron CRC 45.181 y USD 4,95 correctamente; la segunda produjo la
advertencia de moneda en un bolsillo CRC. Esas llamadas tardaron aproximadamente
24 y 16 segundos, por encima del objetivo de 5–10 segundos. Dos muestras no
constituyen una evaluación general de precisión.

### Comparación de razonamiento: 13 de septiembre de 2026

Se compararon `low` y `none` con cinco comprobantes: las dos imágenes aportadas
por el usuario y las muestras públicas
[000](https://github.com/zzzDavid/ICDAR-2019-SROIE/blob/master/data/img/000.jpg),
[010](https://github.com/zzzDavid/ICDAR-2019-SROIE/blob/master/data/img/010.jpg) y
[020](https://github.com/zzzDavid/ICDAR-2019-SROIE/blob/master/data/img/020.jpg)
de SROIE. Tres repeticiones por imagen y configuración dieron 30 llamadas reales,
secuenciales, alternando el orden de las configuraciones y rotando las imágenes.
Solo cambió `reasoning_effort`: mismos bytes, prompt, bolsillo CRC, etiquetas
vacías, límite de 4096 tokens, timeout de 30 segundos y ningún reintento automático.

| Resultado | `low` | `none` |
| --- | --- | --- |
| Mediana de respuesta | 16,73 s | 10,18 s |
| Percentil 95 (interpolado) | 28,20 s | 24,83 s |
| Respuestas válidas | 15/15 | 15/15 |
| Montos correctos en la respuesta del modelo | 15/15 | 15/15 |
| Montos correctos conservados tras validación | 13/15 | 10/15 |
| Fechas correctas | 15/15 | 14/15 |

Se adopta `none` por una mediana 39% menor en esta muestra, aceptando resultados
parciales para revisión manual. `none` invirtió día/mes una vez, omitió la moneda
de Starbucks dos veces y dejó el tipo de movimiento de la factura vacío dos
veces por falta de contexto sobre el titular. Con `low`, una respuesta asignó
CRC al recibo estadounidense. Los tipos vacíos son abstenciones, no etiquetas
incorrectas.

La validación actual puede descartar un monto fraccionario correctamente leído
cuando la moneda falta o se identifica erróneamente como CRC. Esa limitación
permanece pendiente; cambiar el razonamiento no la resuelve.

Los tiempos cubren únicamente la petición al proveedor, sin carga de archivos,
procesamiento de PDF ni espera de la aplicación. Algunas llamadas con `none`
tardaron 24–26 segundos. Cinco imágenes no garantizan precisión o latencia
general; no se probaron PDF, ingresos ni documentos de varias páginas. La caché
del proveedor y las condiciones de red no estuvieron controladas, y las muestras
públicas podrían formar parte de datos de entrenamiento. No se enviaron
comprobantes de producción durante esta comparación.
