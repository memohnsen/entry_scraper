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
        await page.goto('https://usaweightlifting.sport80.com/public/events/12845/entries/19313?bl=wizard', {
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
                    return {
                        memberId: cells[0]?.textContent.trim(),
                        firstName: cells[1]?.textContent.trim(),
                        lastName: cells[2]?.textContent.trim(),
                        state: cells[3]?.textContent.trim(),
                        yearOfBirth: cells[4]?.textContent.trim(),
                        age: cells[5]?.textContent.trim(),
                        club: cells[6]?.textContent.trim(),
                        gender: cells[7]?.textContent.trim(),
                        division: cells[8]?.textContent.trim(),
                        weightClass: cells[9]?.textContent.trim(),
                        entryTotal: cells[10]?.textContent.trim()
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
                // Wait for network request to complete
                await page.waitForResponse(response => 
                    response.url().includes('entries') && response.status() === 200
                );
                // Additional wait for data to load
                await page.waitForTimeout(2000);
                pageNum++;
            } else {
                hasNextPage = false;
            }
        }

        // Save the data
        const fs = require('fs');
        fs.writeFileSync('weightlifting_entries.json', JSON.stringify(allEntries, null, 2));
        
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