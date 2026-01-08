// File: Data/LoadTrackerRepository.cs
using Dapper;
using Microsoft.Data.SqlClient;
using LoadTrackerWeb.Models;

namespace LoadTrackerWeb.Data;

public sealed class LoadTrackerRepository
{
    private readonly IConfiguration _cfg;
    public LoadTrackerRepository(IConfiguration cfg) => _cfg = cfg;

    private SqlConnection OpenLoadTracker() =>
        new SqlConnection(_cfg.GetConnectionString("LoadTrackerDb"));

    public async Task<List<(string CustomerCode, string CallName)>> GetCustomersAsync(CancellationToken ct)
    {
        const string sql = @"
SELECT DISTINCT
    LTRIM(RTRIM([CUSTOMER])) AS CustomerCode,
    MAX(LTRIM(RTRIM([CALLNAME]))) AS CallName
FROM dbo.LoadTracker
WHERE [CUSTOMER] IS NOT NULL AND LTRIM(RTRIM([CUSTOMER])) <> ''
GROUP BY LTRIM(RTRIM([CUSTOMER]))
ORDER BY MAX(LTRIM(RTRIM([CALLNAME])));
";
        await using var con = OpenLoadTracker();
        var rows = await con.QueryAsync<(string CustomerCode, string CallName)>(
            new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<string?> GetCustomerNameAsync(string customerCode, CancellationToken ct)
    {
        const string sql = @"
SELECT TOP 1 [CALLNAME]
FROM dbo.LoadTracker
WHERE [CUSTOMER] = @CustomerCode
ORDER BY [CALLNAME];
";
        await using var con = OpenLoadTracker();
        return await con.QueryFirstOrDefaultAsync<string>(
            new CommandDefinition(sql, new { CustomerCode = customerCode }, cancellationToken: ct));
    }

    // Strongly typed row mapping for safer code (no dynamic null warnings)
    private sealed class LoadRowRaw
    {
        public int DetailLineId { get; init; }
        public string? Probill { get; init; }
        public string? BolNo { get; init; }
        public string? OrderNo { get; init; }
        public string? PoNo { get; init; }
        public string? Receiver { get; init; }
        public string? ReceiverCity { get; init; }
        public string? ReceiverProv { get; init; }

        public DateTime? ActualPickup { get; init; }
        public DateTime? PickupBy { get; init; }
        public DateTime? PickupByEnd { get; init; }

        public DateTime? DeliverBy { get; init; }
        public DateTime? DeliverByEnd { get; init; }

        public string? CurrentStatus { get; init; }
        public DateTime? ActualDelivery { get; init; }

        public bool Exception { get; init; }

        public string? SfShortDesc { get; init; }
        public string? UsrSfShortDesc { get; init; }
        public string? Comments { get; init; }
    }

    public async Task<List<LoadRowViewModel>> GetLoadsForMonthAsync(
        string customerCode, DateTime start, DateTime end, CancellationToken ct)
    {
        // FILTER RULE (your request):
        // - If ACTUAL_PICKUP exists: include row when ACTUAL_PICKUP is within [start,end)
        // - If ACTUAL_PICKUP is NULL: include row when PICK_UP_BY is within [start,end)
        //
        // Display rule:
        // - Show pickup date as (ACTUAL_PICKUP ?? PICK_UP_BY) to avoid blank pickup date.
        const string sql = @"
SELECT
    [DETAIL_LINE_ID] AS DetailLineId,
    [BILL_NUMBER]    AS Probill,
    [BOL #]          AS BolNo,
    [ORDER #]        AS OrderNo,
    [PO #]           AS PoNo,
    [DESTNAME]       AS Receiver,
    [DESTCITY]       AS ReceiverCity,
    [DESTPROV]       AS ReceiverProv,

    [ACTUAL_PICKUP]  AS ActualPickup,
    [PICK_UP_BY]     AS PickupBy,
    [PICK_UP_BY_END] AS PickupByEnd,

    [DELIVER_BY]     AS DeliverBy,
    [DELIVER_BY_END] AS DeliverByEnd,
    [CURRENT_STATUS] AS CurrentStatus,
    [ACTUAL_DELIVERY] AS ActualDelivery,
    [EXCEPTION]      AS Exception,
    [SF_SHORT_DESC]  AS SfShortDesc,
    [USR_SF_SHORT_DESC] AS UsrSfShortDesc,
    [COMMENTS]       AS Comments
FROM dbo.LoadTracker
WHERE [CUSTOMER] = @CustomerCode
  AND (
        ([ACTUAL_PICKUP] >= @StartUtcOrLocal AND [ACTUAL_PICKUP] < @EndUtcOrLocal)
     OR ([ACTUAL_PICKUP] IS NULL AND [PICK_UP_BY] >= @StartUtcOrLocal AND [PICK_UP_BY] < @EndUtcOrLocal)
  )
ORDER BY
    COALESCE([ACTUAL_PICKUP], [PICK_UP_BY]),
    [DETAIL_LINE_ID];
";

        await using var con = OpenLoadTracker();

        var rows = await con.QueryAsync<LoadRowRaw>(
            new CommandDefinition(
                sql,
                new
                {
                    CustomerCode = customerCode,
                    StartUtcOrLocal = start,
                    EndUtcOrLocal = end
                },
                cancellationToken: ct));

        var list = new List<LoadRowViewModel>();

        foreach (var r in rows)
        {
            // Keep RAD based on Deliver window (as your UI currently does)
            string radText = BuildRadText(r.DeliverBy, r.DeliverByEnd);
            string onTime = ComputeOnTime(r.ActualDelivery, r.DeliverBy, r.DeliverByEnd);

            string? usrDelay = r.UsrSfShortDesc;
            string? sfDelay = r.SfShortDesc;
            string? effectiveDelay = !string.IsNullOrWhiteSpace(usrDelay) ? usrDelay : sfDelay;

            string? deliveryDateText = r.ActualDelivery?.ToString("yyyy-MM-dd");
            string? deliveryTimeText = r.ActualDelivery?.ToString("HH:mm");

            // Show ACTUAL_PICKUP if present, otherwise show PICK_UP_BY
            DateTime? pickupForDisplay = r.ActualPickup ?? r.PickupBy;

            list.Add(new LoadRowViewModel
            {
                DetailLineId = r.DetailLineId,
                // Probill = r.Probill,
                Probill = FormatProbillForDisplay(r.Probill),
                BolNo = r.BolNo,
                OrderNo = r.OrderNo,
                PoNo = r.PoNo,
                Receiver = r.Receiver,
                ReceiverCity = r.ReceiverCity,
                ReceiverProv = r.ReceiverProv,

                ActualPickup = pickupForDisplay,

                DeliverBy = r.DeliverBy,
                DeliverByEnd = r.DeliverByEnd,
                RadText = radText,
                CurrentStatus = r.CurrentStatus,
                ActualDelivery = r.ActualDelivery,
                DeliveryDateText = deliveryDateText,
                DeliveryTimeText = deliveryTimeText,
                Exception = r.Exception,
                OnTimeText = onTime,
                NonCarrierDelay = effectiveDelay,
                UserNonCarrierDelay = usrDelay,
                Comments = r.Comments
            });
        }

        return list;
    }

    public async Task<bool> UpdateEditableFieldsAsync(
        string customerCode,
        int detailLineId,
        bool exception,
        string? userDelay,
        string? comments,
        CancellationToken ct)
    {
        // Hard safety rules:
        // - Update ONLY the three allowed columns
        // - Also include CUSTOMER in WHERE (prevents cross-customer updates)
        // - Parameterized SQL (no injection)
        const string sql = @"
UPDATE dbo.LoadTracker
SET
    [EXCEPTION] = @Exception,
    [USR_SF_SHORT_DESC] = @UsrSfShortDesc,
    [COMMENTS] = @Comments
WHERE [DETAIL_LINE_ID] = @DetailLineId
  AND [CUSTOMER] = @CustomerCode;
";

        userDelay = string.IsNullOrWhiteSpace(userDelay) ? null : userDelay.Trim();
        comments = string.IsNullOrWhiteSpace(comments) ? null : comments.Trim();

        await using var con = OpenLoadTracker();
        int affected = await con.ExecuteAsync(new CommandDefinition(
            sql,
            new
            {
                Exception = exception,
                UsrSfShortDesc = userDelay,
                Comments = comments,
                DetailLineId = detailLineId,
                CustomerCode = customerCode
            },
            cancellationToken: ct));

        return affected == 1;
    }

    private static string BuildRadText(DateTime? start, DateTime? end)
    {
        if (start is null && end is null) return "";

        if (start is not null && end is not null)
        {
            if (start.Value.Date == end.Value.Date)
                return $"{start:yyyy-MM-dd HH:mm}–{end:HH:mm}";

            return $"{start:yyyy-MM-dd HH:mm} – {end:yyyy-MM-dd HH:mm}";
        }

        return start is not null
            ? start.Value.ToString("yyyy-MM-dd HH:mm")
            : end!.Value.ToString("yyyy-MM-dd HH:mm");
    }


    private static string? FormatProbillForDisplay(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return raw;

    raw = raw.Trim();

    // Only remove prefix if it's C or T (case-insensitive)
    if (raw.Length > 1 && (raw[0] == 'C' || raw[0] == 'c' || raw[0] == 'T' || raw[0] == 't'))
        raw = raw.Substring(1);

    // Remove leading zeros, keep the rest (ex: "00003255.1" -> "3255.1")
    raw = raw.TrimStart('0');

    // If it was all zeros (or "C0000"), show "0"
    return raw.Length == 0 ? "0" : raw;
}


    private static string ComputeOnTime(DateTime? actual, DateTime? windowStart, DateTime? windowEnd)
    {
        if (actual is null) return "";

        if (windowStart is not null && windowEnd is not null)
            return (actual.Value >= windowStart.Value && actual.Value <= windowEnd.Value) ? "YES" : "NO";

        if (windowStart is not null && windowEnd is null)
            return (actual.Value <= windowStart.Value) ? "YES" : "NO";

        return "";
    }
}
