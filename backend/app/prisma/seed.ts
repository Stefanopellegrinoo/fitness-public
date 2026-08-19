import { PrismaClient, ExerciseCategory, Equipment } from '@prisma/client';
import { loadFoodSeedData, upsertFoods } from '../src/lib/nutrition/foodSeed';

const prisma = new PrismaClient();

const exercises = [
  // PECHO
  { name: 'Press de Banca', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Mayor', 'Pectoral Menor'], equipment: Equipment.BARBELL, isCompound: true, description: 'Ejercicio compuesto fundamental para pectorales' },
  { name: 'Press de Banca Inclinado', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Superior'], equipment: Equipment.BARBELL, isCompound: true, description: 'Press inclinado para pectorales superiores' },
  { name: 'Aperturas con Mancuernas', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Mayor'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Ejercicio de aislamiento para pectorales' },
  { name: 'Flexiones', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Mayor'], equipment: Equipment.BODYWEIGHT, isCompound: true, description: 'Ejercicio básico con peso corporal' },
  { name: 'Press Inclinado con Mancuernas', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Superior'], equipment: Equipment.DUMBBELL, isCompound: true, description: 'Press inclinado con mancuernas' },
  { name: 'Crossover en Polea', category: ExerciseCategory.PECHO, primaryMuscles: ['Pectoral Mayor'], equipment: Equipment.CABLE, isCompound: false, description: 'Cruce de poleas para pectoral' },

  // ESPALDA
  { name: 'Peso Muerto', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsales', 'Erectores', 'Glúteos'], equipment: Equipment.BARBELL, isCompound: true, description: 'Ejercicio compuesto fundamental para espalda baja' },
  { name: 'Dominadas', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsales', 'Bíceps'], equipment: Equipment.BODYWEIGHT, isCompound: true, description: 'Ejercicio compuesto para dorsales' },
  { name: 'Remo con Barra', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsales', 'Trapecio'], equipment: Equipment.BARBELL, isCompound: true, description: 'Remo horizontal con barra' },
  { name: 'Jalón al Pecho', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsales'], equipment: Equipment.MACHINE, isCompound: false, description: 'Jalón en máquina para dorsales' },
  { name: 'Remo con Mancuerna', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsal', 'Romboides'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Remo unilateral con mancuerna' },
  { name: 'Remo en Polea Baja', category: ExerciseCategory.ESPALDA, primaryMuscles: ['Dorsales', 'Romboides'], equipment: Equipment.CABLE, isCompound: false, description: 'Remo horizontal en polea' },

  // HOMBROS
  { name: 'Press de Hombros', category: ExerciseCategory.HOMBROS, primaryMuscles: ['Deltoides', 'Trapecio'], equipment: Equipment.BARBELL, isCompound: true, description: 'Press vertical para hombros' },
  { name: 'Press de Hombros con Mancuernas', category: ExerciseCategory.HOMBROS, primaryMuscles: ['Deltoides'], equipment: Equipment.DUMBBELL, isCompound: true, description: 'Press de hombros bilateral con mancuernas' },
  { name: 'Elevaciones Laterales', category: ExerciseCategory.HOMBROS, primaryMuscles: ['Deltoides Lateral'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Aislamiento para deltoides laterales' },
  { name: 'Face Pull', category: ExerciseCategory.HOMBROS, primaryMuscles: ['Deltoides Posterior', 'Trapecio'], equipment: Equipment.CABLE, isCompound: false, description: 'Ejercicio para hombros posteriores' },
  { name: 'Vuelos Posteriores', category: ExerciseCategory.HOMBROS, primaryMuscles: ['Deltoides Posterior'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Aislamiento para deltoides posterior' },

  // BRAZOS
  { name: 'Curl con Barra', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Bíceps'], equipment: Equipment.BARBELL, isCompound: false, description: 'Curl básico para bíceps' },
  { name: 'Curl con Mancuernas', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Bíceps'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Curl alternado con mancuernas' },
  { name: 'Curl Martillo', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Bíceps', 'Braquial'], equipment: Equipment.DUMBBELL, isCompound: false, description: 'Curl con grip neutro' },
  { name: 'Extensiones de Tríceps en Polea', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Tríceps'], equipment: Equipment.CABLE, isCompound: false, description: 'Press down para tríceps en polea' },
  { name: 'Press Francés', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Tríceps'], equipment: Equipment.BARBELL, isCompound: false, description: 'Extensión de tríceps acostado' },
  { name: 'Fondos en Paralelas', category: ExerciseCategory.BRAZOS, primaryMuscles: ['Tríceps', 'Pectoral'], equipment: Equipment.BODYWEIGHT, isCompound: true, description: 'Fondos para tríceps y pectoral inferior' },

  // PIERNAS
  { name: 'Sentadilla', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Cuádriceps', 'Glúteos'], equipment: Equipment.BARBELL, isCompound: true, description: 'Ejercicio compuesto fundamental para piernas' },
  { name: 'Prensa de Piernas', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Cuádriceps', 'Glúteos'], equipment: Equipment.MACHINE, isCompound: true, description: 'Ejercicio en máquina para piernas' },
  { name: 'Peso Muerto Rumano', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Isquiotibiales', 'Glúteos'], equipment: Equipment.BARBELL, isCompound: true, description: 'Ejercicio para isquiotibiales y glúteos' },
  { name: 'Curl de Piernas', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Isquiotibiales'], equipment: Equipment.MACHINE, isCompound: false, description: 'Aislamiento para isquiotibiales' },
  { name: 'Extensión de Cuádriceps', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Cuádriceps'], equipment: Equipment.MACHINE, isCompound: false, description: 'Aislamiento para cuádriceps' },
  { name: 'Elevación de Talones', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Gemelos'], equipment: Equipment.MACHINE, isCompound: false, description: 'Aislamiento para gemelos' },
  { name: 'Zancadas con Mancuernas', category: ExerciseCategory.PIERNAS, primaryMuscles: ['Cuádriceps', 'Glúteos'], equipment: Equipment.DUMBBELL, isCompound: true, description: 'Zancadas alternadas con mancuernas' },

  // CORE
  { name: 'Plancha', category: ExerciseCategory.CORE, primaryMuscles: ['Core', 'Oblicuos'], equipment: Equipment.BODYWEIGHT, isCompound: false, description: 'Ejercicio isométrico para core' },
  { name: 'Crunch en Polea', category: ExerciseCategory.CORE, primaryMuscles: ['Recto Abdominal'], equipment: Equipment.CABLE, isCompound: false, description: 'Crunch con resistencia' },
  { name: 'Elevación de Piernas Colgado', category: ExerciseCategory.CORE, primaryMuscles: ['Recto Abdominal', 'Flexores de Cadera'], equipment: Equipment.BODYWEIGHT, isCompound: false, description: 'Elevación de piernas en barra' },
];

async function main() {
  console.log('Seeding exercises...');
  for (const exercise of exercises) {
    await prisma.exercise.upsert({
      where: { name: exercise.name },
      update: exercise,
      create: exercise,
    });
  }
  console.log(`Seeded ${exercises.length} exercises`);

  console.log('Seeding foods...');
  const foods = loadFoodSeedData();
  const count = await upsertFoods(prisma, foods);
  console.log(`Seeded ${count} foods`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
