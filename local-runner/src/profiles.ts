export interface ContainerProfile {
  command: string;
  image: `${string}@sha256:${string}`;
  language: string;
}

const profiles = [
  profile("python", "docker.io/library/python@sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a", "python3 -"),
  profile("sql", "docker.io/keinos/sqlite3@sha256:7ea29f0c7e91a8c3f315e831459d07000f34e9e9b25fbc30be2e0481b3e0450f", "sqlite3 -batch"),
  // Short-lived compilation benefits from C1 startup; keep the user's JVM defaults.
  profile("kotlin", "docker.io/gmazzo/kotlin@sha256:5b19a73f0ede1f5b103921c3a48ae3035d3fe7cbcde15c3eee039a9a0a3aacfb", "cat > Main.kt; kotlinc -J-XX:TieredStopAtLevel=1 Main.kt -include-runtime -d main.jar; java -jar main.jar"),
  profile("java", "docker.io/library/eclipse-temurin@sha256:6ea5548706b60ac0a602eaf48af74792cbab012d90e811ca8db6184b16b5c3d6", "cat > Main.java; java Main.java"),
  profile("c", "docker.io/library/gcc@sha256:9ca91b05c7b07d2979f16413e8b2cd6ec8a7c80ffca4121ccab0aeba33f90460", "cat > main.c; gcc -std=c17 -O0 -o main main.c; ./main"),
  profile("cpp", "docker.io/library/gcc@sha256:9ca91b05c7b07d2979f16413e8b2cd6ec8a7c80ffca4121ccab0aeba33f90460", "cat > main.cpp; g++ -std=c++20 -O0 -o main main.cpp; ./main"),
  profile("go", "docker.io/library/golang@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59", "cat > main.go; go run main.go"),
  profile("rust", "docker.io/library/rust@sha256:4b800f2e72e04be908e5f634c504c741bd943b763d1d8ad7b096cc340e1b5b46", "cat > main.rs; rustc -o main main.rs; ./main"),
  profile("csharp", "mcr.microsoft.com/dotnet/sdk@sha256:620e765fe18186c08399f7aa978f79f04b6bbf0ee1b3b8a91e2d5c9619e59da1", "cat > Program.cs; printf '%s' '<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>' > Main.csproj; export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1; dotnet workload list >/dev/null 2>&1 || true; dotnet run --project Main.csproj --nologo"),
  profile("swift", "docker.io/library/swift@sha256:159943c473b8d7c57fb18d1f0e9cd7f3b011f05511a39ee1f53ed92bc6cd13d9", "cat > main.swift; swift main.swift"),
  profile("ruby", "docker.io/library/ruby@sha256:c5a5064d190055633011c03aa800170cc36945ff3afb5f6c915329f92d6f1e00", "ruby -"),
  profile("php", "docker.io/library/php@sha256:2f389f933c3cc58cc622bd243bb4ecff7e6553e2de4387a239bca640c988be19", "php"),
  profile("r", "docker.io/library/r-base@sha256:fa1972f31def171b83e0911e947ab8b57db143f0fc8a67af4c0d5ac329041646", "Rscript -"),
  profile("dart", "docker.io/library/dart@sha256:7e57e61d97813dc57dd0801656ff4d5c5efafa47bae563a681571543ad30f199", "cat > main.dart; dart run main.dart"),
  profile("lua", "docker.io/nickblah/lua@sha256:d2f20d6ec71f987f79ca0f25d5d9a2b3620f97db179f9a2b8f2177c3330952f9", "lua -"),
  profile("shell", "docker.io/library/alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce", "sh -s")
] as const satisfies readonly ContainerProfile[];

export const CONTAINER_PROFILES: ReadonlyMap<string, ContainerProfile> = new Map(
  profiles.map((value) => [value.language, value])
);

function profile(language: string, image: ContainerProfile["image"], command: string): ContainerProfile {
  return { command, image, language };
}
