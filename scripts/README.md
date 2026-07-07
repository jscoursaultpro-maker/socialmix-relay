# Relay Server

Backend server for SocialMixApp.

## Scripts

### Bogus Artists Report

To generate a CSV report of tracks with bogus artists (Unknown, Various Artists, etc.):

```bash
MONGODB_URI="your_mongo_uri" node scripts/report-bogus-artists.mjs
```

The script runs in read-only mode (connects to MongoDB with `secondaryPreferred`) and outputs the results to `bogus_artists.csv`. This CSV file is excluded from Git tracking.

### Resolve Bogus Artists via ISRC

To enrich the bogus artists CSV with suggested metadata from the Apple Music API using the ISRC:

```bash
node scripts/resolve-via-isrc.mjs
```

This reads `bogus_artists.csv` and outputs `bogus_artists_enriched.csv` containing a `Confidence_Score` and suggested track metadata.
