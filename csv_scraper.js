// Load environment variables from .env file
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
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
        // Upsert entries one by one to handle the special case for session_number and session_platform
        for (const entry of entries) {
            // Check if the entry already exists
            const { data: existingEntries, error: fetchError } = await supabase
                .from('athletes')
                .select('session_number, session_platform')
                .eq('member_id', entry.member_id)
                .eq('meet', meetName);
                
            if (fetchError) {
                console.error('Error fetching existing entry:', fetchError);
                continue;
            }
            
            if (existingEntries && existingEntries.length > 0) {
                const existingEntry = existingEntries[0];
                
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
                    .eq('member_id', entry.member_id)
                    .eq('meet', meetName);
                    
                if (updateError) {
                    console.error('Error updating entry:', updateError);
                }
            } else {
                // Insert new entry
                const { error: insertError } = await supabase
                    .from('athletes')
                    .insert(entry);
                    
                if (insertError) {
                    console.error('Error inserting entry:', insertError);
                }
            }
        }
        
        console.log(`Successfully updated Supabase with ${entries.length} entries for meet: ${meetName}`);
    } catch (error) {
        console.error('Error updating Supabase:', error);
        throw error;
    }
}

if (require.main === module) {
    console.log('Starting scraper...');
    scrapeWeightliftingData()
        .then(() => {
            console.log('Scraping and database update completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed with error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWeightliftingData }; 