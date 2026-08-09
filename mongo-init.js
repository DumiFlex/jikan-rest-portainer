const userToCreate = process.env.JIKAN_DB_USERNAME;
const userPassword = process.env.JIKAN_DB_PASSWORD;
db = db.getSiblingDB("admin");
db.createUser({ user: userToCreate, pwd: userPassword, roles: [{ role: "readWrite", db: "jikan" }] });
db = db.getSiblingDB("jikan");
db.createUser({ user: userToCreate, pwd: userPassword, roles: [{ role: "readWrite", db: "jikan" }] });

const fields = [
  "aired", "airing", "episodes", "members", "favorites", "popularity", "rank",
  "rating", "score", "scored_by", "status", "type", "source",
  "title", "title_english", "title_japanese", "title_synonyms",
  "demographics.mal_id", "explicit_genres.mal_id", "genres.mal_id",
  "licensors.mal_id", "producers.mal_id", "studios.mal_id", "themes.mal_id",
  "aired.from", "aired.to",
];
fields.forEach(f => db.anime.createIndex({ [f]: 1 }, { name: f }));
db.anime.createIndex({ mal_id: 1 }, { name: "mal_id", unique: true });
db.anime.createIndex(
  { title: "text", title_japanese: "text" },
  { name: "search", weights: { title: 50, title_japanese: 5 } }
);
print("anime indexes created: " + db.anime.getIndexes().length);
