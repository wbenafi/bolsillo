# Estadísticas por bolsillo

Cada bolsillo tiene las pestañas **Movimientos** y **Estadísticas**. Las estadísticas están disponibles también para bolsillos archivados y respetan el acceso a la cuenta.

## Alcance

- Últimos 7, 30 o 90 días, este mes, últimos X días y fechas personalizadas. El período inicial es de 30 días; las fechas y la agrupación quedan en la URL.
- Ingresos, gastos, flujo neto y gasto diario promedio.
- Gráfico por día, semana o mes, con tabla accesible y selección de fechas para consultar sus movimientos.
- Desglose de ingresos y gastos por tags, incluido **Sin tags**.
- Comparaciones con el período anterior y observaciones calculadas a partir de registros guardados.
- Consulta paginada de los movimientos detrás de los totales, barras e insights.

## Reglas de cálculo

Las fechas inicial y final son inclusivas. Los últimos X días incluyen hoy. El promedio divide los gastos entre todos los días calendario del período, incluidos los días sin movimientos. El flujo neto es ingresos menos gastos del período: no es el saldo disponible ni una estimación de ahorro.

El período anterior tiene exactamente la misma cantidad de días y termina el día anterior al período seleccionado. Si el primer movimiento registrado es posterior al inicio de ese período anterior, se indica que el historial es insuficiente y no se publican comparaciones. La existencia de registros antiguos no garantiza que el usuario haya registrado toda su actividad; el informe siempre describe movimientos registrados.

Cuando el valor anterior es cero, se muestra la diferencia monetaria sin porcentaje. Las cantidades conservan las unidades menores de la moneda del bolsillo; solo el promedio se redondea al mostrarse.

Un movimiento con varios tags aparece en cada tag asignado, pero se cuenta una sola vez en los totales. El desglose explica este solapamiento y no presenta las barras como partes exclusivas de un total. No se mezclan monedas ni bolsillos. Los borradores y lecturas de comprobantes sin guardar no se incluyen.

Las semanas van de lunes a domingo y los meses siguen el calendario. Los extremos del gráfico se recortan al rango seleccionado. Se admiten hasta 3660 días por consulta. La interfaz no permite fechas posteriores a hoy.

## Implementación y verificación

`transactions.getWalletStatistics` consulta el índice existente `by_wallet_date` para el período actual y anterior. `transactions.listStatisticsTransactions` pagina el detalle con el mismo índice, filtrando tipo y tags. Las consultas vuelven a validar identidad, cuenta y propiedad del bolsillo. No se requieren nuevas tablas ni dependencias.

El filtro por tags conserva los cursores originales incluso si una página no contiene coincidencias. En ese caso, la interfaz permite cargar más registros sin declarar que la búsqueda terminó.

Pruebas: `lib/statistics.test.ts` y `convex/statistics.test.ts`. Cubren límites inclusivos, años bisiestos, días sin gastos, bases porcentuales cero, períodos parciales, tags superpuestos, monedas, autorización, archivado, cambios de movimientos y paginación.

Para verificar manualmente, abrir un bolsillo con registros, entrar en Estadísticas, cambiar el período y la agrupación, seleccionar una barra o tag, y revisar sus movimientos. Probar también un bolsillo vacío, una moneda USD y un bolsillo archivado.
