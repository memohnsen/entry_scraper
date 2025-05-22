# Weightlifting Entry Scraper

This is a GitHub Action that scrapes USA Weightlifting competition entries and updates a Supabase database.

## How it works

1. The script runs daily at configured times
2. It scrapes the entries from the USA Weightlifting website for specific meets
3. It extracts the meet name from the page
4. It upserts the entries to the Supabase `athletes` table:
   - If entries already exist for the meet, it updates all fields except `session_number` and `session_platform` (these are preserved if not null)
   - If entries don't exist, it inserts new records

## Setup

1. Fork this repository
2. Add the following secrets to your GitHub repository:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase service role key (or at minimum a key with insert/update permissions on the athletes table)

3. Make sure your Supabase database has an `athletes` table with the following schema:
   ```sql
   create table athletes (
     id uuid default uuid_generate_v4() primary key,
     member_id text not null,
     name text not null,
     age integer,
     club text,
     gender text,
     weight_class text,
     entry_total integer,
     session_number text,
     session_platform text,
     meet text not null,
     unique(member_id, meet)
   );
   ```

## Adding New Meets to Track

This repository is set up to track multiple meets simultaneously. Each meet has its own workflow file with a hardcoded URL:

1. Duplicate the template file `.github/workflows/scrape-template.yml`
2. Rename it to reflect the meet (e.g., `.github/workflows/scrape-my-meet.yml`)
3. Edit the file and:
   - Update the workflow name
   - Set a unique cron schedule time (to avoid conflicts)
   - Replace the URL in the `TARGET_URL` environment variable with the correct event URL
   
Example:
```yaml
name: Scrape My Meet

on:
  schedule:
    - cron: '10 2 * * *'  # Run at 2:10 AM UTC
  workflow_dispatch:

env:
  TARGET_URL: 'https://usaweightlifting.sport80.com/public/events/12345/entries/67890?bl='

jobs:
  scrape:
    # ... other settings remain the same ...
    
    steps:
      # ... other steps remain the same ...
      
      - name: Run scraper
        run: node csv_scraper.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

Each workflow will run independently on its schedule and update the database with entries for its specific meet.

## Local Development

To run the scraper locally:

1. Install dependencies: `npm install`
2. Create a target_url.txt file with the URL:
   ```
   echo "https://usaweightlifting.sport80.com/public/events/12345/entries/67890?bl=" > target_url.txt
   ```
3. Set environment variables:
   ```
   export SUPABASE_URL=your_supabase_url
   export SUPABASE_KEY=your_supabase_key
   ```
4. Run the scraper: `node csv_scraper.js` 