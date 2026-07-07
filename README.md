# Relay Server

Backend server for SocialMixApp.

## Scripts

### Bogus Artists Report

To generate a CSV report of tracks with bogus artists (Unknown, Various Artists, etc.):

```bash
MONGODB_URI="your_mongo_uri" node scripts/report-bogus-artists.mjs
```

The script runs in read-only mode (connects to MongoDB with `secondaryPreferred`) and outputs the results to `bogus_artists.csv`. This CSV file is excluded from Git tracking.
