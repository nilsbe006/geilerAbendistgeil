// Getränkekarte – nur alkoholisch.
// ml = Glasgröße, abv = effektiver Alkoholgehalt des fertigen Drinks in %.
// phase = wann der Drink am besten passt: early (Warm-up), mid (Hauptteil), late (Endspurt), any.

const CATEGORIES = [
  { id: "bier", label: "Bier", emoji: "🍺", phase: ["any"] },
  { id: "wein", label: "Wein & Sekt", emoji: "🍷", phase: ["early", "mid"] },
  { id: "aperitif", label: "Spritz", emoji: "🍹", phase: ["early"] },
  { id: "longdrink", label: "Longdrinks", emoji: "🥃", phase: ["mid", "late"] },
  { id: "cocktail", label: "Cocktails", emoji: "🍸", phase: ["mid"] },
  { id: "shot", label: "Shots", emoji: "🔥", phase: ["late"] },
];

const DRINKS = [
  // Bier
  { id: "pils", name: "Pils", emoji: "🍺", cat: "bier", ml: 330, abv: 4.9, phase: ["any"] },
  { id: "helles", name: "Helles", emoji: "🍺", cat: "bier", ml: 500, abv: 5.0, phase: ["any"] },
  { id: "weizen", name: "Weizen", emoji: "🍺", cat: "bier", ml: 500, abv: 5.4, phase: ["early", "mid"] },
  { id: "radler", name: "Radler", emoji: "🍋", cat: "bier", ml: 500, abv: 2.5, phase: ["early"] },
  { id: "ipa", name: "Craft IPA", emoji: "🍻", cat: "bier", ml: 330, abv: 6.5, phase: ["mid"] },
  { id: "cider", name: "Cider", emoji: "🍏", cat: "bier", ml: 330, abv: 4.5, phase: ["early", "mid"] },

  // Wein & Sekt
  { id: "sekt", name: "Sekt", emoji: "🥂", cat: "wein", ml: 100, abv: 11, phase: ["early"] },
  { id: "prosecco", name: "Prosecco", emoji: "🍾", cat: "wein", ml: 100, abv: 11, phase: ["early"] },
  { id: "weisswein", name: "Weißwein", emoji: "🥂", cat: "wein", ml: 200, abv: 12, phase: ["early", "mid"] },
  { id: "rotwein", name: "Rotwein", emoji: "🍷", cat: "wein", ml: 200, abv: 13.5, phase: ["mid"] },
  { id: "rose", name: "Rosé", emoji: "🌸", cat: "wein", ml: 200, abv: 12, phase: ["early"] },
  { id: "schorle", name: "Weinschorle", emoji: "🥂", cat: "wein", ml: 250, abv: 6, phase: ["early"] },
  { id: "gluehwein", name: "Glühwein", emoji: "♨️", cat: "wein", ml: 200, abv: 10, phase: ["early", "mid"] },

  // Spritz & Aperitif
  { id: "aperol", name: "Aperol Spritz", emoji: "🍹", cat: "aperitif", ml: 200, abv: 8, phase: ["early"] },
  { id: "hugo", name: "Hugo", emoji: "🌿", cat: "aperitif", ml: 200, abv: 6, phase: ["early"] },
  { id: "lillet", name: "Lillet Wild Berry", emoji: "🫐", cat: "aperitif", ml: 250, abv: 4, phase: ["early"] },
  { id: "campari", name: "Campari Orange", emoji: "🍊", cat: "aperitif", ml: 200, abv: 5, phase: ["early", "mid"] },

  // Longdrinks
  { id: "gintonic", name: "Gin Tonic", emoji: "🥃", cat: "longdrink", ml: 250, abv: 6.4, phase: ["mid", "late"] },
  { id: "cubalibre", name: "Cuba Libre", emoji: "🥤", cat: "longdrink", ml: 250, abv: 6.4, phase: ["mid", "late"] },
  { id: "vodkamate", name: "Vodka Mate", emoji: "🧉", cat: "longdrink", ml: 330, abv: 4.5, phase: ["mid", "late"] },
  { id: "jackycola", name: "Jacky Cola", emoji: "🥃", cat: "longdrink", ml: 250, abv: 6.4, phase: ["mid", "late"] },
  { id: "moscowmule", name: "Moscow Mule", emoji: "🫚", cat: "longdrink", ml: 250, abv: 6.4, phase: ["mid"] },
  { id: "vodkae", name: "Vodka-E", emoji: "⚡", cat: "longdrink", ml: 250, abv: 6, phase: ["late"] },

  // Cocktails
  { id: "mojito", name: "Mojito", emoji: "🌱", cat: "cocktail", ml: 300, abv: 6.7, phase: ["mid"] },
  { id: "caipi", name: "Caipirinha", emoji: "🍋", cat: "cocktail", ml: 250, abv: 9.5, phase: ["mid"] },
  { id: "pinacolada", name: "Piña Colada", emoji: "🍍", cat: "cocktail", ml: 300, abv: 8, phase: ["mid"] },
  { id: "sexonthebeach", name: "Sex on the Beach", emoji: "🏖️", cat: "cocktail", ml: 300, abv: 6.7, phase: ["mid"] },
  { id: "longisland", name: "Long Island Iced Tea", emoji: "🧊", cat: "cocktail", ml: 350, abv: 11.4, phase: ["late"] },
  { id: "espressomartini", name: "Espresso Martini", emoji: "☕", cat: "cocktail", ml: 120, abv: 20, phase: ["mid", "late"] },
  { id: "margarita", name: "Margarita", emoji: "🍸", cat: "cocktail", ml: 150, abv: 15, phase: ["mid"] },
  { id: "sunrise", name: "Tequila Sunrise", emoji: "🌅", cat: "cocktail", ml: 300, abv: 7.6, phase: ["mid"] },

  // Shots
  { id: "tequila", name: "Tequila", emoji: "🌵", cat: "shot", ml: 20, abv: 38, phase: ["late"] },
  { id: "jaeger", name: "Jägermeister", emoji: "🦌", cat: "shot", ml: 20, abv: 35, phase: ["late"] },
  { id: "mexikaner", name: "Mexikaner", emoji: "🌶️", cat: "shot", ml: 20, abv: 15, phase: ["mid", "late"] },
  { id: "pfeffi", name: "Pfeffi", emoji: "🍬", cat: "shot", ml: 20, abv: 18, phase: ["late"] },
  { id: "sambuca", name: "Sambuca", emoji: "🔥", cat: "shot", ml: 20, abv: 38, phase: ["late"] },
  { id: "feigling", name: "Kleiner Feigling", emoji: "🍾", cat: "shot", ml: 20, abv: 20, phase: ["late"] },
  { id: "jaegerbomb", name: "Jägerbomb", emoji: "💣", cat: "shot", ml: 200, abv: 7, phase: ["late"] },
];
