# Lectura de comprobantes: producción

La función permite extraer un movimiento desde imágenes, PDF o TXT mediante
`qwen3.8-flash` y el SDK de OpenAI, con `reasoning_effort: "none"` para reducir
la espera. La persona revisa y guarda siempre.

## Variables del backend

Configurar estas variables en el deployment **Production de Convex**:

| Variable | Propósito |
| --- | --- |
| `QWEN_API_KEY` | Clave del proveedor usada por las acciones del backend |
| `QWEN_BASE_URL` | Endpoint HTTPS compatible con Chat Completions que sirve `qwen3.8-flash` |
| `QWEN_INPUT_USD_PER_MILLION` | Tarifa de entrada para estimar costos |
| `QWEN_OUTPUT_USD_PER_MILLION` | Tarifa de salida para estimar costos |

No requieren variables nuevas en Vercel ni prefijos `NEXT_PUBLIC_`. Las tarifas
son opcionales; sin ellas se registran análisis y tokens, pero no una estimación
de costo. El registro de costos no sustituye la factura del proveedor.

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

## Evidencia de validación previa al PR

Pasaron lint, TypeScript, build y 89 tests. La verificación local con MinIO
incluyó cargas/descargas firmadas, rechazo de firmas modificadas y el flujo de
revisión. Dos llamadas reales al modelo, con las muestras proporcionadas por el
usuario, extrajeron CRC 45.181 y USD 4,95 correctamente; la segunda produjo la
advertencia de moneda en un bolsillo CRC. Esas llamadas tardaron aproximadamente
24 y 16 segundos, por encima del objetivo de 5–10 segundos. Dos muestras no
constituyen una evaluación general de precisión.

## Comparación de razonamiento: 13 de septiembre de 2026

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
