WITH
bol_rnk AS (
    SELECT
        t.DETAIL_NUMBER AS DETAIL_LINE_ID,
        t.TRACE_NUMBER  AS BOL_NO,
        ROW_NUMBER() OVER (
            PARTITION BY t.DETAIL_NUMBER
            ORDER BY      t.TRACE_ID DESC
        ) AS rn
    FROM TMWIN.TRACE t
    WHERE t.DESC IN ('BOL', 'BOL #')
),
bol_one AS (
    SELECT DETAIL_LINE_ID, BOL_NO
    FROM bol_rnk
    WHERE rn = 1
),

order_rnk AS (
    SELECT
        t.DETAIL_NUMBER AS DETAIL_LINE_ID,
        t.TRACE_NUMBER  AS ORDER_NO,
        ROW_NUMBER() OVER (
            PARTITION BY t.DETAIL_NUMBER
            ORDER BY      t.TRACE_ID DESC
        ) AS rn
    FROM TMWIN.TRACE t
    WHERE t.DESC = 'ORDER #'
),
order_one AS (
    SELECT DETAIL_LINE_ID, ORDER_NO
    FROM order_rnk
    WHERE rn = 1
),


tldtl_rnk AS (
    SELECT
        d.ORDER_ID,
        d.CUBE_UNITS,
        d.WEIGHT_UNITS,
        d.TEMPERATURE,
        d.TEMPERATURE_UNITS,
        ROW_NUMBER() OVER (
            PARTITION BY d.ORDER_ID
            ORDER BY
                CASE WHEN d.TEMPERATURE IS NOT NULL THEN 0 ELSE 1 END,
                d.SEQUENCE
        ) AS rn
    FROM TMWIN.TLDTL d
),
tldtl_one AS (
    SELECT
        ORDER_ID,
        CUBE_UNITS,
        WEIGHT_UNITS,
        TEMPERATURE,
        TEMPERATURE_UNITS
    FROM tldtl_rnk
    WHERE rn = 1
),

odrstat_delivery AS (
    SELECT
        o.ORDER_ID AS DETAIL_LINE_ID,
        MIN(DATE(o.CHANGED)) AS ACTUAL_DELIVERY_STATUS
    FROM TMWIN.ODRSTAT o
    WHERE o.STATUS_CODE IN ('COMPLETE','DOCKED')
    GROUP BY o.ORDER_ID
),

tl_filtered AS (
    SELECT tl.*
    FROM   TMWIN.TLORDER tl
    WHERE  tl.PICK_UP_BY >= (CURRENT TIMESTAMP - 1 MONTH)
       AND COALESCE(tl.DELIVER_BY_END, tl.DELIVER_BY) <= (CURRENT TIMESTAMP + 1 MONTH)
       AND tl.CUSTOMER IN ('18396','45289')
)

SELECT
    tl.DETAIL_LINE_ID,
    tl.BILL_NUMBER,
    COALESCE(b.BOL_NO,   '') AS "BOL #",
    COALESCE(o.ORDER_NO, '') AS "ORDER #",

    tl.DESTINATION,
    tl.DESTNAME,
    tl.DESTCITY,
    tl.DESTPROV,

    tl.CUSTOMER,
    tl.CALLNAME,

    tl.ORIGIN,
    tl.ORIGNAME,
    tl.ORIGCITY,
    tl.ORIGPROV,

    tl.PICK_UP_BY,
    tl.PICK_UP_BY_END,
    tl.DELIVER_BY,
    tl.DELIVER_BY_END,
    os.ACTUAL_DELIVERY_STATUS AS ACTUAL_DELIVERY,

    tl.CURRENT_STATUS,
    tl.PALLETS,
    tl.CUBE,
    dtl.CUBE_UNITS,
    tl.WEIGHT,
    dtl.WEIGHT_UNITS,

    
    
    dtl.TEMPERATURE,
    dtl.TEMPERATURE_UNITS,

    tl.DANGEROUS_GOODS,
    tl.REQUESTED_EQUIPMEN
FROM tl_filtered tl
LEFT JOIN bol_one   b   ON b.DETAIL_LINE_ID = tl.DETAIL_LINE_ID
LEFT JOIN order_one o   ON o.DETAIL_LINE_ID = tl.DETAIL_LINE_ID
LEFT JOIN tldtl_one dtl ON dtl.ORDER_ID     = tl.DETAIL_LINE_ID
LEFT JOIN odrstat_delivery  os  ON os.DETAIL_LINE_ID   = tl.DETAIL_LINE_ID
ORDER BY tl.PICK_UP_BY, tl.DETAIL_LINE_ID;
