const { chromium } = require('playwright');

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
        await page.goto('https://usaweightlifting.sport80.com/public/events/13435/entries/20071?bl=', {
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
                    const firstName = cells[1]?.textContent.trim();
                    const lastName = cells[2]?.textContent.trim().split(' ')[0];
                    const club = cells[6]?.textContent.trim();
                    const gender = cells[7]?.textContent.trim();
                    const weightClass = cells[9]?.textContent.trim();
                    return `{ name: "${firstName} ${lastName}", club: "${club}", weightCategory: "${gender} ${weightClass}kg", entryTotal: "${cells[10]?.textContent.trim()}" }`;
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
                    // Try to wait for response, but continue if it times out
                    await Promise.race([
                        page.waitForResponse(response => 
                            response.url().includes('entries') && response.status() === 200
                        ),
                        page.waitForTimeout(5000) // 5 second timeout
                    ]);
                } catch (error) {
                    console.log('Response wait timed out, continuing...');
                }
                // Additional wait for data to load
                await page.waitForTimeout(2000);
                pageNum++;
            } else {
                hasNextPage = false;
            }
        }

        // Sort the entries before saving
        const sortedEntries = allEntries
            // First convert strings back to objects for sorting
            .map(entry => {
                // Use Function constructor to safely evaluate the string to an object
                return Function(`return ${entry}`)();
            })
            // Sort by weightCategory and entryTotal
            .sort((a, b) => {
                // Extract weight value and check for '+' prefix
                const getWeight = (str) => {
                    const match = str.match(/(\+)?(\d+)/);
                    if (!match) return { value: Infinity, hasPlus: false };
                    return {
                        value: parseInt(match[2]),
                        hasPlus: match[1] === '+'
                    };
                };
                
                const weightA = getWeight(a.weightCategory);
                const weightB = getWeight(b.weightCategory);
                
                // First sort by gender
                if (a.weightCategory.startsWith('Female') && !b.weightCategory.startsWith('Female')) return -1;
                if (!a.weightCategory.startsWith('Female') && b.weightCategory.startsWith('Female')) return 1;
                
                // Then by weight class, treating '+' as distinct
                if (weightA.value !== weightB.value) return weightA.value - weightB.value;
                if (weightA.hasPlus !== weightB.hasPlus) return weightA.hasPlus ? 1 : -1;
                
                // Finally by entry total
                return parseInt(a.entryTotal) - parseInt(b.entryTotal);
            })
            // Convert back to formatted strings
            .map(entry => `{ name: "${entry.name}", club: "${entry.club}", weightCategory: "${entry.weightCategory}", entryTotal: "${entry.entryTotal}" }`);

        // Save the data as TypeScript
        const fs = require('fs');
        const tsContent = `// Entry type definition
interface WeightliftingEntry { 
    name: string; 
    club: string;
    weightCategory: string; 
    entryTotal: string; 
}

// Scraped entries data
export const entries: WeightliftingEntry[] = [
${sortedEntries.join(',\n')}
];`;
        
        fs.writeFileSync('ao1_adaptive_entries.ts', tsContent);
        
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