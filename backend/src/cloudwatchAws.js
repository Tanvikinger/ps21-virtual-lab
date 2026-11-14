// Thin wrapper around the AWS SDK v3 CloudWatch client. The SDK is imported lazily so the rest of the backend (and its
// tests) work even when CloudWatch is switched off. Credentials are NOT passed here: the SDK default chain is used
// (environment variables, ~/.aws profile / SSO, or the IAM role of the EC2 instance).
export async function createAwsCloudWatchAdapter({ region }) {
  let sdk;
  try { sdk = await import('@aws-sdk/client-cloudwatch'); }
  catch { throw new Error('The CloudWatch SDK is not installed. Run "npm install" inside backend/ (or rebuild the Docker image).'); }
  const client = new sdk.CloudWatchClient({ region });

  return {
    async putMetrics(namespace, data) {
      for (let i = 0; i < data.length; i += 900) {
        await client.send(new sdk.PutMetricDataCommand({ Namespace: namespace, MetricData: data.slice(i, i + 900) }));
      }
    },
    /** metrics: [{ name, stat }] -> { [name]: [{ t, v }] } ascending by time. */
    async getMetrics({ namespace, dimensions, metrics, startMs, endMs, periodSec }) {
      const r = await client.send(new sdk.GetMetricDataCommand({
        StartTime: new Date(startMs), EndTime: new Date(endMs), ScanBy: 'TimestampAscending',
        MetricDataQueries: metrics.map((m, i) => ({
          Id: `m${i}`, ReturnData: true,
          MetricStat: { Metric: { Namespace: namespace, MetricName: m.name, Dimensions: dimensions }, Period: periodSec, Stat: m.stat },
        })),
      }));
      const out = {};
      metrics.forEach((m, i) => {
        const res = (r.MetricDataResults ?? []).find((x) => x.Id === `m${i}`);
        out[m.name] = (res?.Timestamps ?? []).map((ts, k) => ({ t: new Date(ts).getTime(), v: res.Values[k] }));
      });
      return out;
    },
    async putAlarm(params) { await client.send(new sdk.PutMetricAlarmCommand(params)); },
    async listAlarms(prefix) {
      const r = await client.send(new sdk.DescribeAlarmsCommand({ AlarmNamePrefix: prefix, MaxRecords: 20 }));
      return (r.MetricAlarms ?? []).map((a) => ({
        name: a.AlarmName, state: a.StateValue, reason: a.StateReason, metric: a.MetricName, threshold: a.Threshold,
        comparison: a.ComparisonOperator, updatedAt: a.StateUpdatedTimestamp,
      }));
    },
  };
}
