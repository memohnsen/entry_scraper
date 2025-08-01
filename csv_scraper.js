// Load environment variables from .env file
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;

try {
    if (!supabaseUrl || !supabaseKey) {
        console.warn('Supabase credentials not provided. Database updates will be skipped.');
        supabase = null;
    } else {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('Supabase client initialized successfully');
    }
} catch (error) {
    console.error('Error initializing Supabase client:', error);
    supabase = null;
}

// Read the target URL from file
let targetUrl;
try {
    targetUrl = fs.readFileSync('target_url.txt', 'utf8').trim();
    console.log(`Target URL loaded from file: ${targetUrl}`);
} catch (error) {
    console.error('Error reading target URL file:', error);
    process.exit(1);
}

async function scrapeWeightliftingData() {
    console.log('Launching browser...');
    const browser = await chromium.launch({
        headless: true
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    try {
        console.log(`Navigating to page: ${targetUrl}`);
        await page.goto(targetUrl, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('Waiting for table to load...');
        // Wait for actual data to load (not the loading placeholder)
        await page.waitForFunction(() => {
            const firstCell = document.querySelector('table tbody tr td');
            return firstCell && !firstCell.textContent.includes('Loading');
        }, { timeout: 30000 });

        // Extract meet name from the page
        let meetName;
        try {
            meetName = await page.evaluate(() => {
                const titleElement = document.querySelector('h1');
                const eventInfoElement = document.querySelector('.event-info h2');
                
                if (titleElement) {
                    return titleElement.textContent.trim();
                } else if (eventInfoElement) {
                    return eventInfoElement.textContent.trim();
                } else {
                    // Try to find any heading that might contain the meet name
                    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
                    for (const heading of headings) {
                        if (heading.textContent.includes('Championship') || 
                            heading.textContent.includes('Meet') || 
                            heading.textContent.includes('Competition')) {
                            return heading.textContent.trim();
                        }
                    }
                    
                    // If we still can't find it, try to extract from the page title
                    const pageTitle = document.title;
                    if (pageTitle) {
                        return pageTitle.split('|')[0].trim();
                    }
                    
                    return null;
                }
            });
            
            // Remove " - Members" suffix if present
            if (meetName && meetName.endsWith(' - Members')) {
                meetName = meetName.replace(' - Members', '');
            }
            
            if (!meetName) {
                // If we couldn't extract the meet name, use the URL to generate one
                const url = page.url();
                const eventIdMatch = url.match(/events\/(\d+)/);
                if (eventIdMatch && eventIdMatch[1]) {
                    meetName = `Event ID ${eventIdMatch[1]}`;
                    console.warn(`Could not extract meet name from page, using fallback: ${meetName}`);
                } else {
                    meetName = `Weightlifting Event ${new Date().toISOString().split('T')[0]}`;
                    console.warn(`Could not extract meet name or event ID, using date-based fallback: ${meetName}`);
                }
            }
        } catch (error) {
            // If there's an error in the extraction, use a fallback with the current date
            meetName = `Weightlifting Event ${new Date().toISOString().split('T')[0]}`;
            console.error(`Error extracting meet name: ${error.message}. Using fallback: ${meetName}`);
        }
        
        console.log(`Meet name: ${meetName}`);

        let hasNextPage = true;
        let allEntries = [];
        let pageNum = 1;

        while (hasNextPage) {
            // Wait for table data to be fully loaded
            await page.waitForFunction(() => {
                const rows = document.querySelectorAll('table tbody tr');
                const firstCell = rows[0]?.querySelector('td');
                return firstCell && !firstCell.textContent.includes('Loading');
            }, { timeout: 10000 });
            
            console.log(`Scraping page ${pageNum}...`);
            
            // Extract data from current page
            const pageEntries = await page.evaluate((meetName) => {
                const rows = Array.from(document.querySelectorAll('table tbody tr'));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells[0]?.textContent.includes('Loading')) {
                        return null;
                    }
                    const memberId = cells[0]?.textContent.trim();
                    const firstName = cells[1]?.textContent.trim();
                    const lastName = cells[2]?.textContent.trim().split(' ')[0];
                    const age = cells[5]?.textContent.trim();
                    const club = cells[6]?.textContent.trim();
                    const gender = cells[7]?.textContent.trim();
                    const weightClass = cells[9]?.textContent.trim();
                    const entryTotal = cells[10]?.textContent.trim();
                    
                    return {
                        member_id: memberId,
                        name: `${firstName} ${lastName}`,
                        age: parseInt(age),
                        club: club,
                        gender: gender,
                        weight_class: weightClass,
                        entry_total: parseInt(entryTotal),
                        session_number: null,
                        session_platform: null,
                        meet: meetName
                    };
                }).filter(entry => entry !== null);
            }, meetName);

            if (pageEntries.length === 0) {
                console.log('No valid entries found on current page, ending pagination');
                break;
            }

            allEntries = [...allEntries, ...pageEntries];
            console.log(`Found ${pageEntries.length} entries on page ${pageNum}`);

            // Check for next page
            const nextButton = await page.$('button[aria-label="Next page"]:not([disabled])');
            if (nextButton) {
                await nextButton.click();
                try {
                    await Promise.race([
                        page.waitForResponse(response => 
                            response.url().includes('entries') && response.status() === 200
                        ),
                        page.waitForTimeout(5000)
                    ]);
                } catch (error) {
                    console.log('Response wait timed out, continuing...');
                }
                await page.waitForTimeout(2000);
                pageNum++;
            } else {
                hasNextPage = false;
            }
        }

        // Sort the entries
        const sortedEntries = allEntries.sort((a, b) => {
            // Sort by gender first (Female before Male)
            if (a.gender !== b.gender) {
                return a.gender === 'Female' ? -1 : 1;
            }

            // Extract weight value and check for '+' prefix
            const getWeight = (str) => {
                const match = str.match(/(\+)?(\d+)/);
                if (!match) return { value: Infinity, hasPlus: false };
                return {
                    value: parseInt(match[2]),
                    hasPlus: match[1] === '+'
                };
            };
            
            const weightA = getWeight(a.weight_class);
            const weightB = getWeight(b.weight_class);
            
            if (weightA.value !== weightB.value) return weightA.value - weightB.value;
            if (weightA.hasPlus !== weightB.hasPlus) return weightA.hasPlus ? 1 : -1;
            
            return b.entry_total - a.entry_total;
        });

        // CSV output removed
        
        console.log(`Successfully scraped ${allEntries.length} total entries (${Math.ceil(allEntries.length / 20)} pages)`);
        
        // Update Supabase
        await updateSupabase(sortedEntries);
        
        return allEntries;

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
    }
}

async function updateSupabase(entries) {
    if (!supabase) {
        console.error('Supabase client not initialized. Skipping database update.');
        return;
    }
    
    if (entries.length === 0) {
        console.log('No entries to update in Supabase');
        return;
    }
    
    const meetName = entries[0].meet;
    console.log(`Updating Supabase with entries for meet: ${meetName}`);
    
    try {
        // Get all existing entries for this meet to check for existing athletes by name
        const { data: existingMeetEntries, error: fetchMeetError } = await supabase
            .from('athletes')
            .select('member_id, name, session_number, session_platform')
            .eq('meet', meetName);
            
        if (fetchMeetError) {
            console.error('Error fetching existing meet entries:', fetchMeetError);
            return;
        }
        
        // Create a map of existing entries in this meet by name (case-insensitive)
        const existingByName = new Map();
        if (existingMeetEntries) {
            existingMeetEntries.forEach(entry => {
                const normalizedName = entry.name.toLowerCase().trim();
                existingByName.set(normalizedName, entry);
            });
        }
        
        // Get all existing member IDs from the database to check for duplicates across meets
        const { data: allExistingMembers, error: fetchAllError } = await supabase
            .from('athletes')
            .select('member_id, meet');
            
        if (fetchAllError) {
            console.error('Error fetching all existing members:', fetchAllError);
        }
        
        // Create a set of all existing member IDs across all meets
        const allExistingMemberIds = new Set();
        if (allExistingMembers) {
            allExistingMembers.forEach(member => {
                allExistingMemberIds.add(member.member_id);
            });
        }
        
        // Generate a random 9-digit number that doesn't exist in the database
        const generateUniqueMemberId = () => {
            let newId;
            do {
                // Generate random 9-digit number
                newId = Math.floor(100000000 + Math.random() * 900000000).toString();
            } while (allExistingMemberIds.has(newId));
            
            // Add to set to avoid duplicates in current batch
            allExistingMemberIds.add(newId);
            return newId;
        };
        
        let processedCount = 0;
        let insertedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        
        // Process entries one by one
        for (const entry of entries) {
            const normalizedEntryName = entry.name.toLowerCase().trim();
            const existingEntry = existingByName.get(normalizedEntryName);
            
            if (existingEntry) {
                // Athlete name already exists in this meet
                console.log(`Found existing athlete: ${entry.name} in meet: ${meetName}`);
                
                // Check if any important fields have changed (excluding session data)
                const hasChanges = (
                    existingEntry.member_id !== entry.member_id ||
                    entry.age !== parseInt(existingEntry.age) ||
                    entry.club !== existingEntry.club ||
                    entry.gender !== existingEntry.gender ||
                    entry.weight_class !== existingEntry.weight_class ||
                    entry.entry_total !== parseInt(existingEntry.entry_total)
                );
                
                if (hasChanges) {
                    // Preserve the existing member_id and session data
                    entry.member_id = existingEntry.member_id;
                    
                    // Preserve session_number and session_platform if they are not null
                    if (existingEntry.session_number !== null) {
                        entry.session_number = existingEntry.session_number;
                    }
                    
                    if (existingEntry.session_platform !== null) {
                        entry.session_platform = existingEntry.session_platform;
                    }
                    
                    // Update the entry
                    const { error: updateError } = await supabase
                        .from('athletes')
                        .update(entry)
                        .eq('member_id', existingEntry.member_id)
                        .eq('meet', meetName);
                        
                    if (updateError) {
                        console.error(`Error updating entry for ${entry.name}:`, updateError);
                    } else {
                        console.log(`Updated athlete: ${entry.name} in meet: ${meetName}`);
                        updatedCount++;
                    }
                } else {
                    console.log(`No changes detected for athlete: ${entry.name} in meet: ${meetName} - skipping`);
                    skippedCount++;
                }
            } else {
                // Athlete name doesn't exist in this meet
                
                // Check if the member_id is already used in ANY meet
                if (allExistingMemberIds.has(entry.member_id)) {
                    // Member ID exists but name doesn't exist in this meet
                    // This means it's likely the same person in a different meet
                    // Generate a new member_id for this meet entry
                    const originalId = entry.member_id;
                    entry.member_id = generateUniqueMemberId();
                    console.log(`Member ID ${originalId} exists in other meets. Generated new ID ${entry.member_id} for ${entry.name} in meet: ${meetName}`);
                }
                
                // Insert new entry
                const { error: insertError } = await supabase
                    .from('athletes')
                    .insert(entry);
                    
                if (insertError) {
                    console.error(`Error inserting entry for ${entry.name}:`, insertError);
                } else {
                    console.log(`Inserted new athlete: ${entry.name} in meet: ${meetName}`);
                    insertedCount++;
                    // Add the new entry to our local map to avoid duplicates in this batch
                    existingByName.set(normalizedEntryName, {
                        member_id: entry.member_id,
                        name: entry.name,
                        session_number: entry.session_number,
                        session_platform: entry.session_platform
                    });
                }
            }
            processedCount++;
        }
        
        console.log(`Successfully processed ${processedCount} entries for meet: ${meetName}`);
        console.log(`  - Inserted: ${insertedCount}`);
        console.log(`  - Updated: ${updatedCount}`);
        console.log(`  - Skipped (no changes): ${skippedCount}`);
    } catch (error) {
        console.error('Error updating Supabase:', error);
        throw error;
    }
}

async function sendDiscordNotification(athleteCount, meetName) {
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    
    if (!discordWebhookUrl) {
        console.log('Discord webhook URL not configured. Skipping notification.');
        return;
    }
    
    // Get current timestamp in a readable format
    const currentTime = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    
    // Create the message
    const message = `${athleteCount} Athletes Added to Supabase for ${meetName} at ${currentTime}`;
    
    const payload = JSON.stringify({
        content: message
    });
    
    return new Promise((resolve, reject) => {
        const url = new URL(discordWebhookUrl);
        
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`Discord notification sent successfully: ${message}`);
                    resolve(data);
                } else {
                    console.error(`Failed to send Discord notification: ${res.statusCode} ${res.statusMessage}`);
                    if (data) {
                        console.error(`Discord webhook response: ${data}`);
                    }
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`Failed to send Discord notification:`, error.message);
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            const timeoutError = new Error('Discord webhook request timed out');
            console.error('Failed to send Discord notification:', timeoutError.message);
            reject(timeoutError);
        });
        
        req.write(payload);
        req.end();
    });
}

if (require.main === module) {
    console.log('Starting scraper...');
    scrapeWeightliftingData()
        .then(async (entries) => {
            console.log('Scraping and database update completed successfully');
            
            // Send Discord notification
            if (entries && entries.length > 0) {
                const meetName = entries[0].meet;
                try {
                    await sendDiscordNotification(entries.length, meetName);
                } catch (discordError) {
                    console.error('Discord notification failed, but continuing:', discordError.message);
                }
            }
            
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed with error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWeightliftingData }; 