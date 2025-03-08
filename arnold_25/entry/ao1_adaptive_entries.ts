// Entry type definition
interface WeightliftingEntry { 
    name: string; 
    club: string;
    weightCategory: string; 
    entryTotal: string; 
}

// Scraped entries data
export const entries: WeightliftingEntry[] = [
{ name: "Samantha Love", club: "Bexar Barbell", weightCategory: "Female 64kg", entryTotal: "141" },
{ name: "Ashley Collazo", club: "Maxx Effort Training", weightCategory: "Female 87kg", entryTotal: "122" },
{ name: "Helen Filosa", club: "Anna Banana Barbell Club", weightCategory: "Female +87kg", entryTotal: "135" },
{ name: "Angel Santiago", club: "Maxx Effort Training", weightCategory: "Male 55kg", entryTotal: "38" },
{ name: "Thomas Osborne", club: "Bexar Barbell", weightCategory: "Male 81kg", entryTotal: "250" },
{ name: "Justus Foster", club: "Moran Academy", weightCategory: "Male 89kg", entryTotal: "160" },
{ name: "Thomas Smalley", club: "Bexar Barbell", weightCategory: "Male 89kg", entryTotal: "218" },
{ name: "Jack Halstead", club: "Bexar Barbell", weightCategory: "Male 96kg", entryTotal: "188" },
{ name: "Eric Hale", club: "Bexar Barbell", weightCategory: "Male 109kg", entryTotal: "255" }
];