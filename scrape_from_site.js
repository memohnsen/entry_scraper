const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-writer').createObjectCsvWriter;

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
        console.log('Navigating to page...');
        await page.goto('https://usaweightlifting.sport80.com/public/events/13735/entries/20476?bl=wizard', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('Waiting for table to load...');
        // Wait for actual data to load (not the loading placeholder)
        await page.waitForFunction(() => {
            const firstCell = document.querySelector('table tbody tr td');
            return firstCell && !firstCell.textContent.includes('Loading');
        }, { timeout: 30000 });

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
            const pageEntries = await page.evaluate(() => {
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
                        meet: '2025 USA Weightlifting National Championships, Powered by Rogue Fitness'
                    };
                }).filter(entry => entry !== null);
            });

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

        // Create CSV writer
        const csvWriter = csv({
            path: 'adap_entries.csv',
            header: [
                { id: 'member_id', title: 'member_id' },
                { id: 'name', title: 'name' },
                { id: 'age', title: 'age' },
                { id: 'club', title: 'club' },
                { id: 'gender', title: 'gender' },
                { id: 'weight_class', title: 'weight_class' },
                { id: 'entry_total', title: 'entry_total' },
                { id: 'session_number', title: 'session_number' },
                { id: 'session_platform', title: 'session_platform' },
                { id: 'meet', title: 'meet' }
            ]
        });

        // Write to CSV
        await csvWriter.writeRecords(sortedEntries);
        
        console.log(`Successfully scraped ${allEntries.length} total entries (${Math.ceil(allEntries.length / 20)} pages)`);
        return allEntries;

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
    }
}

if (require.main === module) {
    console.log('Starting scraper...');
    scrapeWeightliftingData()
        .then(() => {
            console.log('Scraping completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed with error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWeightliftingData }; 