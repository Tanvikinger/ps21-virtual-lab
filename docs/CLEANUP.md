# Cleanup guide

## Local
```powershell
docker compose down            # stop containers, KEEP data
docker compose down -v         # stop and DELETE the OpenSearch volume (all indexed traces)
docker image prune             # optional: remove unused images
```
## AWS (only what you created for this project)
```powershell
$B = "your-bucket"; $R = "ap-south-1"
aws s3 ls s3://$B/telemetry/ --recursive            # review first
aws s3 rm s3://$B/telemetry/ --recursive            # delete archived objects
aws s3api delete-bucket --bucket $B --region $R     # bucket must be empty (and unversioned)
aws cloudwatch delete-alarms --alarm-names TraceFlow-HighErrorRate --region $R   # custom metrics expire by themselves after 15 months
```
IAM: detach and delete the policy/user/role you created for this project (IAM console -> Policies -> your policy -> "Entities attached" first).
EC2 (if you used it): terminate the instance, delete its EBS volume and any Elastic IP, delete the security group. Then check **Billing -> Cost Explorer** the next day.
Never delete resources of your other AWS project.
